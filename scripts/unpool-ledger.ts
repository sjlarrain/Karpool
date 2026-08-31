import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// D-49 cleanup. Removes the rider `pool` rows that scripts/repool-ledger.ts wrote this morning,
// because riders no longer earn points at all (developer, 2026-08-31).
//
//   before   driver: 1 drive (10 + fill bonus)   each rider: 1 pool (3)
//   after    driver: 1 drive (10 + fill bonus)   each rider: nothing
//
// The driver's rows are never touched, so no driver's total moves. Riders keep their visible
// "pooled" count — since D-49 that number is a count of confirmed trip_rider seats on closed
// trips, not of ledger rows, so deleting these rows costs the rider nothing but the points.
//
// Deleting rather than posting a compensating admin_adjust is the same reasoning D-41 used: an
// adjustment would zero the score and leave the row behind, and a `pool` row no longer means
// anything at all in the new model. It is not history being rewritten, it is a rule that no
// longer exists.
//
// Dry-run by default; --yes to execute. Every row removed is backed up to scripts/backups first.

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

async function main() {
  const execute = process.argv.includes("--yes");
  const env = loadEnvLocal();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: profiles } = await admin.from("profile").select("id, display_name");
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const { data, error } = await admin
    .from("points_ledger")
    .select("id, profile_id, group_id, trip_id, kind, points, reason, created_at")
    .eq("kind", "pool")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const doomed = (data ?? []) as LedgerRow[];
  if (doomed.length === 0) {
    console.log("Nothing to remove — no `pool` rows left in points_ledger.");
    return;
  }

  const byProfile = new Map<string, { rows: number; points: number }>();
  for (const row of doomed) {
    const current = byProfile.get(row.profile_id) ?? { rows: 0, points: 0 };
    current.rows += 1;
    current.points += row.points;
    byProfile.set(row.profile_id, current);
  }

  console.log(`Found ${doomed.length} rider \`pool\` row(s) across ${byProfile.size} profile(s):\n`);
  for (const [profileId, tally] of byProfile) {
    const name = nameOf.get(profileId) ?? profileId;
    console.log(`  ${name.padEnd(22)} -${tally.points} pts  (${tally.rows} row(s))`);
  }
  const total = doomed.reduce((sum, r) => sum + r.points, 0);
  console.log(`\n  ${doomed.length} row(s), -${total} points total. No driver row is touched.`);
  console.log("  Every rider keeps their pooled count: it is read from their confirmed seats now.");

  if (!execute) {
    console.log("\nDry run. Re-run with --yes to apply.");
    return;
  }

  const dir = path.resolve(__dirname, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `points_ledger-unpool-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backup, JSON.stringify(doomed, null, 2));
  console.log(`\nBacked up to ${path.relative(process.cwd(), backup)}`);

  const { error: deleteError } = await admin
    .from("points_ledger")
    .delete()
    .in("id", doomed.map((r) => r.id));
  if (deleteError) throw new Error(deleteError.message);

  console.log(`Deleted ${doomed.length} row(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
