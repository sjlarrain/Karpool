import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { computeCloseAwards, type CloseRider } from "../src/domain/points";

// D-42 backfill. Rewrites the close awards of already-closed trips from the old driver-side
// pooling to the new rider-side shape:
//
//   before   driver: 1 drive (10) + 1 pool per passenger (3, 5, 7, 9)   passengers: nothing
//   after    driver: 1 drive (10 + 3+5+7+9)                             passengers: 1 pool each
//
// The driver's total is deliberately unchanged — the fill bonus moves inside their drive row
// rather than being taken away. What changes is who holds a `pool` row, which is what the
// leaderboard counts as "pooled".
//
// Guests keep paying the driver's bonus (it is already baked into the sum) and still earn nothing:
// no profile to hold points. Kudos, no-show and late-leave rows are never touched.
//
// Dry-run by default; --yes to execute. Every row removed is backed up first.

const DEFAULT_RIDER_POOL_WEIGHT = 3;

interface LedgerRow {
  id: string;
  profile_id: string;
  group_id: string;
  trip_id: string | null;
  kind: string;
  points: number;
  reason: string;
  created_at: string;
}

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../.env.local");
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const env: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]!] = match[2]!;
  }
  return env;
}

// The column only exists once migration 0018 is applied; before that every group takes the default.
async function riderPoolWeightOf(admin: SupabaseClient, groupId: string): Promise<number> {
  const { data, error } = await admin.from("group").select("rider_pool_weight").eq("id", groupId).maybeSingle();
  if (error || !data) return DEFAULT_RIDER_POOL_WEIGHT;
  return (data as { rider_pool_weight: number }).rider_pool_weight ?? DEFAULT_RIDER_POOL_WEIGHT;
}

async function main() {
  const execute = process.argv.includes("--yes");
  const env = loadEnvLocal();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: profiles } = await admin.from("profile").select("id, display_name");
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const { data: allRows, error } = await admin
    .from("points_ledger")
    .select("id, profile_id, group_id, trip_id, kind, points, reason, created_at")
    .in("kind", ["drive", "pool"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const byTrip = new Map<string, LedgerRow[]>();
  for (const row of (allRows ?? []) as LedgerRow[]) {
    if (!row.trip_id) continue;
    const list = byTrip.get(row.trip_id) ?? [];
    list.push(row);
    byTrip.set(row.trip_id, list);
  }

  const doomed: LedgerRow[] = [];
  const inserts: Record<string, unknown>[] = [];

  for (const [tripId, rows] of byTrip) {
    const { data: trip } = await admin.from("trip").select("id, driver_id, group_id").eq("id", tripId).maybeSingle();
    if (!trip) continue;

    // Already in the new shape: the driver holds no pool rows for this trip. Leave it alone, so the
    // script is safe to re-run and safe to run after some trips have closed under the new code.
    const driverPool = rows.filter((r) => r.profile_id === trip.driver_id && r.kind === "pool");
    if (driverPool.length === 0) continue;

    const driveRow = rows.find((r) => r.profile_id === trip.driver_id && r.kind === "drive");
    if (!driveRow) {
      console.log(`  ! trip ${tripId}: pool rows but no drive row — skipped, needs a human`);
      continue;
    }

    const { data: riders } = await admin
      .from("trip_rider")
      .select("profile_id, guest_name")
      .eq("trip_id", tripId)
      .eq("state", "confirmed");

    const closeRiders: CloseRider[] = (riders ?? []).map((r) => ({
      profileId: r.profile_id,
      name: r.guest_name ?? nameOf.get(r.profile_id!) ?? "A rider",
    }));

    // The bonus is taken from the rows that were actually written, not recomputed from today's
    // weights — those rows are what the driver was paid, and the driver's total must not move.
    const bonus = driverPool.reduce((sum, r) => sum + r.points, 0);
    const riderPoolWeight = await riderPoolWeightOf(admin, trip.group_id);
    const shape = computeCloseAwards(closeRiders, {
      driveWeight: 0,
      poolWeight: 0,
      poolStep: 0,
      riderPoolWeight,
    }, nameOf.get(trip.driver_id));

    console.log(`\n  trip ${tripId} — driver ${nameOf.get(trip.driver_id) ?? trip.driver_id}`);
    console.log(`    drive ${driveRow.points} + bonus ${bonus} -> ${driveRow.points + bonus}, ${driverPool.length} driver pool row(s) removed`);
    for (const r of shape.riders) {
      console.log(`    + ${(nameOf.get(r.profileId) ?? r.profileId).padEnd(20)} pool ${r.award.points}  ${r.award.reason}`);
    }

    doomed.push(...driverPool, driveRow);
    inserts.push({
      profile_id: trip.driver_id,
      group_id: driveRow.group_id,
      trip_id: tripId,
      kind: "drive",
      points: driveRow.points + bonus,
      reason: closeRiders.length === 0 ? "Drove the trip" : `Drove the trip (${closeRiders.length} pooled)`,
      created_at: driveRow.created_at,
    });
    for (const r of shape.riders) {
      inserts.push({
        profile_id: r.profileId,
        group_id: driveRow.group_id,
        trip_id: tripId,
        kind: "pool",
        points: r.award.points,
        reason: r.award.reason,
        created_at: driveRow.created_at,
      });
    }
  }

  if (inserts.length === 0) {
    console.log("Nothing to migrate — every closed trip is already in the D-42 shape.");
    return;
  }

  console.log(`\n  ${doomed.length} row(s) replaced by ${inserts.length}`);
  if (!execute) {
    console.log("\nDry run. Re-run with --yes to apply.");
    return;
  }

  const dir = path.resolve(__dirname, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `points_ledger-prepool-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backup, JSON.stringify(doomed, null, 2));
  console.log(`\nBacked up to ${path.relative(process.cwd(), backup)}`);

  // Insert before delete: a failure here leaves the old rows standing rather than a trip with no
  // awards at all.
  const { error: insertError } = await admin.from("points_ledger").insert(inserts);
  if (insertError) throw new Error(`insert: ${insertError.message}`);

  const { error: deleteError } = await admin
    .from("points_ledger")
    .delete()
    .in("id", doomed.map((r) => r.id));
  if (deleteError) throw new Error(`delete: ${deleteError.message} — INSERTS ALREADY APPLIED, ledger is doubled, restore from ${backup}`);

  console.log(`Replaced ${doomed.length} row(s) with ${inserts.length}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
