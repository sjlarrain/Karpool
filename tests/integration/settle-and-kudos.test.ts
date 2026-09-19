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
const CRON_SECRET = process.env.CRON_SECRET;
const PASSWORD = "close-race-test-password-123!";

const canRun = Boolean(SERVICE_ROLE_KEY && CRON_SECRET);

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${APP_URL}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign in failed for ${email}: ${res.status} ${await res.text()}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

describe.skipIf(!canRun)("settle + kudos never duplicate or drop a points_ledger row", () => {
  let admin: SupabaseClient;
  let driverCookie: string;
  let riderCookie: string;
  let driverId: string;
  let riderId: string;
  let groupId: string;
  const createdTripIds: string[] = [];

  // A scheduled trip departing shortly, so riders can still take a seat (join_trip only admits
  // them to a scheduled trip that has not left) before it is aged into the past and settled.
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

  // D-61: a trip is settled by the SCHEDULER once its departure has passed, and by nothing else.
  // So a test makes a ride happen the way production does — move it into the past, run one tick.
  // `created_at` moves with it because D-47's check guards updates too.
  async function ageTrip(tripId: string): Promise<void> {
    const departAt = new Date(Date.now() - 60_000).toISOString();
    const { error } = await admin
      .from("trip")
      .update({ depart_at: departAt, created_at: departAt })
      .eq("id", tripId);
    if (error) throw error;
  }

  function runTick() {
    return fetch(`${APP_URL}/api/cron/tick`, {
      method: "POST",
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  }

  async function settle(tripId: string): Promise<void> {
    await ageTrip(tripId);
    const tick = await runTick();
    expect(tick.status).toBe(200);
    expect(tick.body?.failures ?? []).toEqual([]);
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
  // a read, so two callers in flight together both saw a settleable trip, both were told it was
  // legal, and both wrote a full set of award rows. One ride, two `drive` rows, twice the points.
  //
  // D-61 changed who races — two overlapping cron ticks rather than two drivers — but not the
  // defect or its fix, so the test follows the writer. Written as two genuinely simultaneous
  // requests: only real concurrency exercises the compare-and-swap.
  it("pays the driver once when two ticks settle the same trip at the same instant", async () => {
    const tripId = await publishTrip();
    await ageTrip(tripId);

    const [a, b] = await Promise.all([runTick(), runTick()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    // Neither tick reports a failure: the loser sees `wrong_status`, which is a lost race and not
    // an error — exactly what it would have been told had it arrived a moment later.
    expect(a.body?.failures ?? []).toEqual([]);
    expect(b.body?.failures ?? []).toEqual([]);

    const rows = await ledgerRows(tripId);
    expect(rows.filter((r) => r.kind === "drive")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "drive")[0]?.points).toBe(10);
  }, 60_000);

  // The claim must also hold against the next tick five minutes later, which meets the same trip.
  it("pays the driver once when the scheduler runs again over a settled trip", async () => {
    const tripId = await publishTrip();
    await settle(tripId);
    await runTick();

    const rows = await ledgerRows(tripId);
    expect(rows.filter((r) => r.kind === "drive")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "drive_adjust")).toHaveLength(0);
  }, 60_000);

  // D-49, asserted end to end rather than only in the pure function: a ride pays the driver and
  // nobody else. This is the test that would have caught the old shape — D-42 put a `pool` row on
  // the rider, and before that on the driver, so this one assertion has now been wrong twice.
  it("puts the whole award on the driver and writes no rider row", async () => {
    const tripId = await publishTrip();
    await joinAsRider(tripId);
    await settle(tripId);

    const rows = await ledgerRows(tripId);
    const drive = rows.filter((r) => r.kind === "drive");

    expect(drive).toHaveLength(1);
    expect(drive[0]!.profile_id).toBe(driverId);
    // 10 drive + a 3-point first seat, the fill bonus still folded in (D-19 economics untouched).
    expect(drive[0]!.points).toBe(13);

    // The rider earns nothing at all — no `pool` row, and no row of any other kind either.
    expect(rows.filter((r) => r.kind === "pool")).toHaveLength(0);
    expect(rows.filter((r) => r.profile_id === riderId)).toHaveLength(0);
  }, 60_000);

  // D-61: every booked seat counts as ridden at departure, and the driver reports the one that
  // didn't — keeping the seat's pay and earning the report bonus on top.
  it("charges a reported no-show and pays the driver for reporting it", async () => {
    const tripId = await publishTrip();
    const seatId = await joinAsRider(tripId);
    await settle(tripId);

    const reported = await fetch(`${APP_URL}/api/trips/${tripId}/no-show`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: driverCookie },
      body: JSON.stringify({ tripRiderId: seatId }),
    });
    expect(reported.status).toBe(200);

    const rows = await ledgerRows(tripId);
    // The seat's 3 points are NOT clawed back: no correction row at all.
    expect(rows.filter((r) => r.kind === "drive")[0]?.points).toBe(13);
    expect(rows.filter((r) => r.kind === "drive_adjust")).toHaveLength(0);
    expect(rows.filter((r) => r.kind === "no_show")).toEqual([
      { profile_id: riderId, kind: "no_show", points: -5 },
    ]);
    expect(rows.filter((r) => r.kind === "no_show_report")).toEqual([
      { profile_id: driverId, kind: "no_show_report", points: 2 },
    ]);

    // Reporting twice charges once.
    const again = await fetch(`${APP_URL}/api/trips/${tripId}/no-show`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: driverCookie },
      body: JSON.stringify({ tripRiderId: seatId }),
    });
    expect(again.status).toBe(409);
    expect((await ledgerRows(tripId)).filter((r) => r.kind === "no_show")).toHaveLength(1);
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
    await joinAsRider(tripId);
    await settle(tripId);

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
