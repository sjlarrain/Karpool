import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../../.env.local");
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const env: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]!] = match[2]!;
  }
  return env;
}

// Deletes every group the e2e driver created (and everything cascading from it — trips, riders,
// kudos, ledger entries, memberships) so repeated local test runs don't accumulate stale data that
// makes ".card first()"-style selectors unreliable across runs.
export async function cleanupE2eData(driverId: string, otherIds: string[] = []) {
  const env = loadEnvLocal();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

  // The seeded accounts publish a trip per spec, and `trip_create` allows 10 per hour — so a few
  // suite runs in quick succession make publishing 429 and the specs fail for a reason that has
  // nothing to do with the code under test. Clearing the counters for the *test* accounts only
  // keeps a red gate meaningful; the limit itself is untouched for everyone else.
  await admin.from("rate_limit_hit").delete().in("profile_id", [driverId, ...otherIds]);

  const { data: groups } = await admin.from("group").select("id").eq("created_by", driverId);
  const groupIds = (groups ?? []).map((g) => g.id);
  if (groupIds.length === 0) return;

  const { data: trips } = await admin.from("trip").select("id").in("group_id", groupIds);
  const tripIds = (trips ?? []).map((t) => t.id);

  if (tripIds.length > 0) {
    await admin.from("kudos").delete().in("trip_id", tripIds);
    await admin.from("notification").delete().in("payload->>tripId", tripIds);
    await admin.from("points_ledger").delete().in("trip_id", tripIds);
    await admin.from("trip_rider").delete().in("trip_id", tripIds);
    await admin.from("trip").delete().in("id", tripIds);
  }
  await admin.from("membership").delete().in("group_id", groupIds);
  await admin.from("pickup_place").delete().in("group_id", groupIds);
  await admin.from("group").delete().in("id", groupIds);
}
