import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Repairs ledger rows duplicated by the replayable-close defect (see src/lib/api/closeTrip.ts):
// the ledger was written, the push layer threw before the status flip, the trip stayed `started`,
// and the driver's next Close tap paid them all over again.
//
// A close writes all of its award rows in ONE insert, so every row from a single close run shares
// an identical created_at. That timestamp is therefore the batch key: for each trip, the earliest
// close batch is the real one and every later batch is a replay. Kudos rows are written by a
// different route at their own time and are never touched.
//
// This is not a rewrite of history — it is the removal of the same event recorded more than once.
// Every deleted row is written to a JSON backup first. Dry-run by default; pass --yes to execute.

const CLOSE_KINDS = ["drive", "pool", "no_show"] as const;

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

/** Every close-award row from a replayed batch: all batches for a trip except the earliest. */
function replayedRows(rows: LedgerRow[]): LedgerRow[] {
  const byTrip = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    if (!row.trip_id) continue;
    if (!CLOSE_KINDS.includes(row.kind as (typeof CLOSE_KINDS)[number])) continue;
    const list = byTrip.get(row.trip_id) ?? [];
    list.push(row);
    byTrip.set(row.trip_id, list);
  }

  const doomed: LedgerRow[] = [];
  for (const tripRows of byTrip.values()) {
    const batches = [...new Set(tripRows.map((r) => r.created_at))].sort();
    if (batches.length < 2) continue;
    const keep = batches[0]!;
    doomed.push(...tripRows.filter((r) => r.created_at !== keep));
  }
  return doomed;
}

async function main() {
  const execute = process.argv.includes("--yes");
  const env = loadEnvLocal();
  const admin: SupabaseClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: profiles } = await admin.from("profile").select("id, display_name");
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const { data, error } = await admin
    .from("points_ledger")
    .select("id, profile_id, group_id, trip_id, kind, points, reason, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const doomed = replayedRows((data ?? []) as LedgerRow[]);
  if (doomed.length === 0) {
    console.log("No replayed close batches found. Nothing to do.");
    return;
  }

  console.log(`${doomed.length} row(s) from replayed close batches:\n`);
  for (const row of doomed) {
    console.log(
      `  ${row.created_at}  ${(nameOf.get(row.profile_id) ?? row.profile_id).padEnd(20)} ${row.kind.padEnd(8)} ${String(row.points).padStart(4)}  ${row.reason}`,
    );
  }
  const net = doomed.reduce((sum, r) => sum + r.points, 0);
  console.log(`\n  net points removed: ${net}`);

  if (!execute) {
    console.log("\nDry run. Re-run with --yes to delete these rows.");
    return;
  }

  const dir = path.resolve(__dirname, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `points_ledger-replays-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
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
  console.error(err.message);
  process.exit(1);
});
