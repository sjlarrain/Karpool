import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Regression cover for the two ways this app has lost or duplicated points_ledger rows.
//
// Both defects live in a route handler talking to Postgres, which is precisely the layer the
// default `pnpm test` gate cannot reach: vitest.config.ts includes only `src/**/*.test.ts`, and
// every one of those 220 tests is a pure function in src/domain/ that imports nothing but its own
// sibling module. A gate made entirely of pure-function tests stays green through any amount of
// route-level breakage — which is how both of these reached production.
//
// So these hit the real handlers over HTTP against a running `pnpm dev`, the same shape as
// tests/admin. Requires a live Supabase project (SUPABASE_SERVICE_ROLE_KEY) and the dev server at
// APP_URL. Skips itself when the key is absent. Run via `pnpm test:integration`.
//
// The concurrency test in particular CANNOT be written any other way: the bug it guards only
// appears when two requests are in flight at once, so no unit test and no single-threaded
// Playwright journey can reproduce it.

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "close-race-test-password-123!";

const canRun = Boolean(SERVICE_ROLE_KEY);

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${APP_URL}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign in failed for ${email}: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

describe.skipIf(!canRun)("close + kudos never duplicate or drop a points_ledger row", () => {
  let admin: SupabaseClient;
  let driverCookie: string;
  let riderCookie: string;
  let driverId: string;
  let riderId: string;
  let groupId: string;
  const createdTripIds: string[] = [];

  // A scheduled trip departing inside D-16's T-2h start window, so it can be started the moment
  // anyone who is going to ride it has taken a seat.
  async function publishTrip(): Promise<string> {
    const { data: trip, error } = await admin
      .from("trip")
      .insert({
        group_id: groupId,
        driver_id: driverId,
        direction: "out",
        depart_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        capacity: 3,
      })
      .select()
      .single();
    if (error || !trip) throw error ?? new Error("failed to insert trip");
    createdTripIds.push(trip.id);
    return trip.id;
  }

  // Seats have to be taken before the trip starts: join_trip() only admits a rider to a `scheduled`
  // trip, which is the whole point of D-24's separate driver-added-passenger route.
  async function joinAsRider(tripId: string): Promise<string> {
    const res = await fetch(`${APP_URL}/api/trips/${tripId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: riderCookie },
      body: JSON.stringify({ wantsReturn: false }),
    });
    expect(res.status).toBe(201);
    const { tripRider } = await res.json();
    return tripRider.id;
  }

  async function startTrip(tripId: string): Promise<void> {
    const started = await fetch(`${APP_URL}/api/trips/${tripId}/start`, {
      method: "POST",
      headers: { cookie: driverCookie },
    });
    expect(started.status).toBe(200);
  }

  async function publishStartedTrip(): Promise<string> {
    const tripId = await publishTrip();
    await startTrip(tripId);
    return tripId;
  }

  function closeAs(cookie: string, tripId: string, confirmedTripRiderIds: string[] = []) {
    return fetch(`${APP_URL}/api/trips/${tripId}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ confirmedTripRiderIds, guestNames: [] }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  }

  async function ledgerRows(tripId: string) {
    const { data } = await admin.from("points_ledger").select("profile_id, kind, points").eq("trip_id", tripId);
    return data ?? [];
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY as string);
    const stamp = Date.now();

    const mkUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `close-race-${label}-${stamp}@example.com`,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { display_name: `Close Race ${label}` },
      });
      if (error || !data.user) throw error ?? new Error(`failed to create ${label}`);
      return data.user.id;
    };

    driverId = await mkUser("driver");
    riderId = await mkUser("rider");

    const { data: group, error: groupErr } = await admin
      .from("group")
      .insert({
        name: `Close Race ${stamp}`,
        origin_label: "A",
        dest_label: "HQ",
        code: `CR${String(stamp).slice(-4)}`,
        created_by: driverId,
      })
      .select()
      .single();
    if (groupErr || !group) throw groupErr ?? new Error("failed to create group");
    groupId = group.id;

    await admin.from("membership").insert([
      { group_id: groupId, profile_id: driverId, group_role: "group_admin" },
      { group_id: groupId, profile_id: riderId, group_role: "member" },
    ]);

    driverCookie = await signIn(`close-race-driver-${stamp}@example.com`, PASSWORD);
    riderCookie = await signIn(`close-race-rider-${stamp}@example.com`, PASSWORD);
  }, 60_000);

  afterAll(async () => {
    if (!canRun || !admin) return;
    for (const tripId of createdTripIds) {
      await admin.from("points_ledger").delete().eq("trip_id", tripId);
      await admin.from("kudos").delete().eq("trip_id", tripId);
      await admin.from("trip_rider").delete().eq("trip_id", tripId);
      await admin.from("notification").delete().contains("payload", { tripId });
      await admin.from("trip").delete().eq("parent_trip_id", tripId);
      await admin.from("trip").delete().eq("id", tripId);
    }
    if (groupId) {
      await admin.from("points_ledger").delete().eq("group_id", groupId);
      await admin.from("membership").delete().eq("group_id", groupId);
      await admin.from("group").delete().eq("id", groupId);
    }
    for (const id of [driverId, riderId].filter(Boolean)) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 60_000);

  // The bug, exactly as reproduced against this project's database on 2026-08-31: `transition()` is
  // a read, so two closes in flight together both saw `started`, both were told the close was legal,
  // and both wrote a full set of award rows. One ride, two `drive` rows, twice the points.
  //
  // Written as two genuinely simultaneous requests rather than a fast loop, because a sequential
  // retry is a DIFFERENT defect ([D-41]) with a different fix, and it was already closed by
  // reordering the writes. Only real concurrency exercises the compare-and-swap.
  it("pays the driver once when two closes arrive at the same instant", async () => {
    const tripId = await publishStartedTrip();

    const [a, b] = await Promise.all([closeAs(driverCookie, tripId), closeAs(driverCookie, tripId)]);
    const statuses = [a.status, b.status].sort();

    // One winner, one loser told the trip is no longer closeable.
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body?.error).toBe("wrong_status");

    const rows = await ledgerRows(tripId);
    expect(rows.filter((r) => r.kind === "drive")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "drive")[0]?.points).toBe(10);
  }, 60_000);

  // The claim must also hold against a plain retry — a driver tapping Close again after a slow
  // reply, which is how [D-41]'s ten duplicate rows reached the live leaderboard.
  it("pays the driver once when a close is retried after it already succeeded", async () => {
    const tripId = await publishStartedTrip();

    const first = await closeAs(driverCookie, tripId);
    expect(first.status).toBe(200);

    const second = await closeAs(driverCookie, tripId);
    expect(second.status).toBe(409);
    expect(second.body?.error).toBe("wrong_status");

    expect((await ledgerRows(tripId)).filter((r) => r.kind === "drive")).toHaveLength(1);
  }, 60_000);

  // D-42's split, asserted end to end rather than only in the pure function: the driver takes the
  // drive row carrying the fill bonus, and the rider takes their own pool row. Before D-42 the pool
  // row landed on the driver, so the word meant its own opposite.
  it("puts the drive row on the driver and the pool row on the rider", async () => {
    const tripId = await publishTrip();
    const seatId = await joinAsRider(tripId);
    await startTrip(tripId);

    const closed = await closeAs(driverCookie, tripId, [seatId]);
    expect(closed.status).toBe(200);

    const rows = await ledgerRows(tripId);
    const drive = rows.filter((r) => r.kind === "drive");
    const pool = rows.filter((r) => r.kind === "pool");

    expect(drive).toHaveLength(1);
    expect(drive[0]!.profile_id).toBe(driverId);
    // 10 drive + a 3-point first seat, the fill bonus folded in (D-42).
    expect(drive[0]!.points).toBe(13);

    expect(pool).toHaveLength(1);
    expect(pool[0]!.profile_id).toBe(riderId);
    expect(pool[0]!.points).toBe(3);
  }, 60_000);

  // The kudos award insert used to discard its error. Because the `kudos` row is written first under
  // unique(trip_id, from_profile_id), a failure there left the rider with a 201, the driver with no
  // points, and no way back — pressing the button again answers 409 already_given for ever.
  //
  // The fault is injected through the public data model rather than a stub: points_ledger carries
  // `check (points <> 0)`, so a group whose kudos_weight is 0 makes the award row unwritable. That
  // is not a contrived value — it is what a group admin would set to turn kudos scoring off, and
  // before this fix it silently ate the rider's one rating.
  it("refuses the kudos and keeps the rider's rating when the award cannot be written", async () => {
    const tripId = await publishTrip();
    const seatId = await joinAsRider(tripId);
    await startTrip(tripId);
    expect((await closeAs(driverCookie, tripId, [seatId])).status).toBe(200);

    await admin.from("group").update({ kudos_weight: 0 }).eq("id", groupId);

    const failed = await fetch(`${APP_URL}/api/trips/${tripId}/kudos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: riderCookie },
      body: JSON.stringify({ comment: "great ride" }),
    });
    expect(failed.status).toBe(500);
    expect((await failed.json())?.error).toBe("kudos_award_failed");

    // Nothing half-written: no orphan kudos row spending the rider's single rating, no award.
    const { data: orphans } = await admin.from("kudos").select("id").eq("trip_id", tripId);
    expect(orphans ?? []).toHaveLength(0);
    expect((await ledgerRows(tripId)).filter((r) => r.kind === "kudos")).toHaveLength(0);

    // And with a workable weight the rating goes through, exactly once, to the driver.
    await admin.from("group").update({ kudos_weight: 2 }).eq("id", groupId);

    const ok = await fetch(`${APP_URL}/api/trips/${tripId}/kudos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: riderCookie },
      body: JSON.stringify({ comment: "great ride" }),
    });
    expect(ok.status).toBe(201);

    const kudosRows = (await ledgerRows(tripId)).filter((r) => r.kind === "kudos");
    expect(kudosRows).toHaveLength(1);
    expect(kudosRows[0]!.profile_id).toBe(driverId);
    expect(kudosRows[0]!.points).toBe(2);
  }, 60_000);
});
