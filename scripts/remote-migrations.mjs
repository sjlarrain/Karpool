// Apply and inspect remote migrations WITHOUT the Supabase CLI.
//
// Why this exists. `npx supabase` cannot run on this machine any more: Windows Device Guard (WDAC)
// is in enforcing mode (`UsermodeCodeIntegrityPolicyEnforcementStatus = 2`) and the CLI ships an
// UNSIGNED `supabase.exe`, so the loader refuses it wherever it is installed. That is a
// machine-wide policy, not a per-shell one — `npx supabase db push` fails from a normal terminal in
// exactly the same way, and reinstalling it elsewhere does not help.
//
// This talks to the Supabase Management API over plain HTTPS instead: no new dependency and no
// binary beyond node itself, since `fetch` is built in. It reads .env.local at runtime the same way
// scripts/audit-ledger.ts does, so no secret is ever typed on a command line.
//
//   node scripts/remote-migrations.mjs --list    read-only: what the remote has vs. this repo
//   node scripts/remote-migrations.mjs           dry run: name what WOULD be applied
//   node scripts/remote-migrations.mjs --yes     apply every unapplied migration, in order
//
// Dry-run-by-default follows scripts/repool-ledger.ts, for the same reason: this writes to the live
// project and there is no local one to rehearse against.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, "../supabase/migrations");

function loadEnvLocal() {
  const lines = fs.readFileSync(path.resolve(here, "../.env.local"), "utf8").split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return env;
}

// The endpoint the dashboard's own SQL editor uses. A failure is reported verbatim rather than
// summarised — a migration that would not apply is worth reading the real message about.
async function runSql(ref, token, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// The CLI keys its ledger on the numeric prefix, so recording the same version here keeps a future
// `supabase db push` (from a machine without the policy) in agreement with what we applied by hand.
const versionOf = (file) => file.split("_")[0];

async function main() {
  const env = loadEnvLocal();
  const token = env.SUPABASE_ACCESS_TOKEN;
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];

  if (!token || token === "REPLACE_ME") {
    console.error("SUPABASE_ACCESS_TOKEN is missing from .env.local.");
    console.error("Create a personal access token at https://supabase.com/dashboard/account/tokens");
    return 1;
  }
  if (!ref) {
    console.error(`Could not read a project ref out of NEXT_PUBLIC_SUPABASE_URL (${url || "unset"}).`);
    return 1;
  }

  const localFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const rows = await runSql(ref, token, "select version from supabase_migrations.schema_migrations order by version;");
  const applied = new Set(rows.map((r) => r.version));
  const pending = localFiles.filter((f) => !applied.has(versionOf(f)));

  if (process.argv.includes("--list")) {
    console.log(`\nproject ${ref}\n`);
    console.log("  local file                                     remote");
    console.log("  ---------------------------------------------  ------");
    for (const f of localFiles) {
      console.log(`  ${f.padEnd(45)}  ${applied.has(versionOf(f)) ? "applied" : "NOT APPLIED"}`);
    }
    // A version on the remote with no file here means someone applied SQL by hand and the repo
    // cannot reproduce the schema — worth knowing about loudly rather than never.
    const orphans = [...applied].filter((v) => !localFiles.some((f) => versionOf(f) === v));
    console.log(
      orphans.length > 0
        ? `\n  on the remote with no file in this repo: ${orphans.join(", ")}`
        : "\n  every remote version has a file in this repo.",
    );
    return 0;
  }

  if (pending.length === 0) {
    console.log("Remote is up to date — nothing to apply.");
    return 0;
  }

  console.log(`\nproject ${ref}`);
  console.log(`${pending.length} migration(s) not yet applied:\n`);
  for (const f of pending) console.log(`  ${f}`);

  if (!process.argv.includes("--yes")) {
    console.log("\nDry run. Re-run with --yes to apply them.\n");
    return 0;
  }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const version = versionOf(file);
    process.stdout.write(`\napplying ${file} ... `);
    try {
      // One transaction per migration, with its version recorded in the same commit: either the
      // schema change and the ledger row both land, or neither does. A migration that applied but
      // went unrecorded is the failure mode that makes the next push try to apply it twice.
      await runSql(
        ref,
        token,
        `begin;\n${sql}\ninsert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${file.replace(/'/g, "''")}');\ncommit;`,
      );
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      console.error(`\n${err.message}\n`);
      console.error("Rolled back. Later migrations were not attempted.");
      return 1;
    }
  }

  console.log("\nDone. Regenerate types next — while the CLI is blocked that means hand-patching");
  console.log("src/types/database.ts, which is what this repo has been doing.\n");
  return 0;
}

// Not process.exit(): exiting mid-flight while a keep-alive socket is still open aborts libuv on
// Windows ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"). Set the code and let the loop
// drain on its own.
process.exitCode = await main();
