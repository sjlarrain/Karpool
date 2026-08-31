import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// Read-only diagnostic. Prints every points_ledger row grouped by trip, so a duplicated close
// (the same trip paying the same driver more than once) is visible at a glance. Writes nothing.

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

  console.log("\n=== totals by profile ===");
  const totals = new Map<string, { driven: number; pooled: number; kudos: number; points: number }>();
  for (const row of rows ?? []) {
    const cur = totals.get(row.profile_id) ?? { driven: 0, pooled: 0, kudos: 0, points: 0 };
    cur.points += row.points;
    if (row.kind === "drive") cur.driven += 1;
    if (row.kind === "pool") cur.pooled += 1;
    if (row.kind === "kudos") cur.kudos += 1;
    totals.set(row.profile_id, cur);
  }
  for (const [pid, t] of totals) {
    console.log(`    ${(nameOf.get(pid) ?? pid).padEnd(20)} ${t.driven} driven · ${t.pooled} pooled · ${t.kudos} kudos = ${t.points}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
