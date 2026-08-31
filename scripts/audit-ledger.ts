import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { aggregateLedger, type LedgerRow } from "../src/domain/leaderboard";

// Read-only diagnostic. Prints every points_ledger row grouped by trip, so a duplicated close
// (the same trip paying the same driver more than once) is visible at a glance. Writes nothing.
//
// The totals come from the app's own aggregateLedger() rather than a copy of the same arithmetic.
// This script used to reimplement it, and D-49 immediately proved why that is a trap: `pooled`
// stopped being a ledger figure, the app followed, and the audit kept counting `pool` rows that no
// longer exist — so it reported 0 pooled for riders the app correctly showed as 1. A diagnostic
// that disagrees with the thing it is diagnosing is worse than none.

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

async function main() {
  const env = loadEnvLocal();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: profiles } = await admin.from("profile").select("id, display_name");
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const { data: rows, error } = await admin
    .from("points_ledger")
    .select("id, profile_id, trip_id, kind, points, reason, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const byTrip = new Map<string, typeof rows>();
  for (const row of rows ?? []) {
    const key = row.trip_id ?? "(no trip)";
    if (!byTrip.has(key)) byTrip.set(key, []);
    byTrip.get(key)!.push(row);
  }

  for (const [tripId, tripRows] of byTrip) {
    const { data: trip } = await admin
      .from("trip")
      .select("id, status, direction, depart_at, closed_at, driver_id, parent_trip_id")
      .eq("id", tripId)
      .maybeSingle();
    console.log(`\n=== trip ${tripId} ===`);
    console.log(
      `    status=${trip?.status} direction=${trip?.direction} depart=${trip?.depart_at} closed=${trip?.closed_at} parent=${trip?.parent_trip_id ?? "-"}`,
    );
    const { data: riders } = await admin
      .from("trip_rider")
      .select("id, profile_id, guest_name, state")
      .eq("trip_id", tripId);
    console.log(
      `    riders: ${(riders ?? []).map((r) => `${r.guest_name ?? nameOf.get(r.profile_id!) ?? r.profile_id}[${r.state}]`).join(", ") || "(none)"}`,
    );
    for (const row of tripRows!) {
      console.log(
        `    ${row.created_at}  ${(nameOf.get(row.profile_id) ?? row.profile_id).padEnd(20)} ${row.kind.padEnd(11)} ${String(row.points).padStart(4)}  ${row.reason}`,
      );
    }
  }

  // D-49: `pooled` is a ride count, not a ledger count — the rider's `confirmed` seats on closed
  // trips. All-time here, matching GET /api/me/points; only the group leaderboard is month-scoped.
  const { data: closedTrips } = await admin.from("trip").select("id").eq("status", "closed");
  const closedIds = (closedTrips ?? []).map((t) => t.id);

  const { data: seats } = closedIds.length > 0
    ? await admin
        .from("trip_rider")
        .select("profile_id")
        .in("trip_id", closedIds)
        .eq("state", "confirmed")
        .not("profile_id", "is", null)
    : { data: [] };

  const pooledRides = new Map<string, number>();
  for (const seat of seats ?? []) {
    if (!seat.profile_id) continue;
    pooledRides.set(seat.profile_id, (pooledRides.get(seat.profile_id) ?? 0) + 1);
  }

  console.log("\n=== totals by profile ===");
  const ledgerRows: LedgerRow[] = (rows ?? []).map((r) => ({
    profileId: r.profile_id,
    kind: r.kind,
    points: r.points,
  }));
  // Someone who has only ever ridden holds no ledger row at all, so they appear here purely from
  // their seats — with rides to show and a score of zero, which is the D-49 model working.
  for (const [pid, t] of aggregateLedger(ledgerRows, pooledRides)) {
    console.log(`    ${(nameOf.get(pid) ?? pid).padEnd(20)} ${t.driven} driven · ${t.pooled} pooled · ${t.kudos} kudos = ${t.points}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
