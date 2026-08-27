import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Destructive. Wipes the activity tables and leaves identity and group configuration standing:
// auth.users, profile, "group", membership, pickup_place and push_subscription are never touched.
// Intended for clearing test data out of a pre-launch environment, which is why it refuses to run
// without --yes.
// Run with: pnpm db:reset-data --yes  (or --dry-run to just see the row counts)

// Order matters: points_ledger references trip without on-delete-cascade, so the ledger has to go
// first. The rest cascade from trip, but they are listed explicitly so the report shows what went.
const TABLES = [
  "kudos",
  "points_ledger",
  "trip_rider",
  "trip",
  "notification",
  "audit_log",
  "feedback",
  "rate_limit_hit",
] as const;

const KEPT = ["auth.users", "profile", "group", "membership", "pickup_place", "push_subscription"];

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

async function countOf(admin: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun && !process.argv.includes("--yes")) {
    throw new Error("Refusing to run without --yes. This permanently deletes all trip and log data.");
  }

  const env = loadEnvLocal();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  }

  const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY);
  process.stdout.write(`Target: ${new URL(url).host}${dryRun ? " (dry run — nothing is deleted)" : ""}\n\n`);

  for (const table of TABLES) {
    const before = await countOf(admin, table);
    if (dryRun) {
      process.stdout.write(`  ${table.padEnd(16)} ${before} rows would be deleted\n`);
      continue;
    }
    // PostgREST requires a filter on every delete; `id is not null` is the "all rows" spelling.
    const { error } = await admin.from(table).delete().not("id", "is", null);
    if (error) throw new Error(`delete ${table}: ${error.message}`);
    const after = await countOf(admin, table);
    process.stdout.write(`  ${table.padEnd(16)} ${before} -> ${after}\n`);
  }

  process.stdout.write(`\nKept: ${KEPT.join(", ")}\n`);
  for (const table of ["profile", "group", "membership", "pickup_place", "push_subscription"]) {
    process.stdout.write(`  ${table.padEnd(16)} ${await countOf(admin, table)} rows\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
