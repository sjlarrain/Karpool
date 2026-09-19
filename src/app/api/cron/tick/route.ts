import { NextResponse } from "next/server";
import { env } from "@/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyProfiles } from "@/lib/notify/tripNotify";
import {
  DEPARTURE_REMINDER_LEAD_MINUTES,
  DEPARTURE_REMINDER_GRACE_MINUTES,
  PARKING_REMINDER_AFTER_MINUTES,
  PARKING_REMINDER_GRACE_MINUTES,
} from "@/domain/constants";
import { isDepartureReminderDue, isParkingReminderDue } from "@/domain/tripReminders";
import { isSettleDue } from "@/domain/tripSettle";
import { parkingUrlForLeg } from "@/domain/parking";
import { settleTrip } from "@/lib/api/settleTrip";

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

// GET/POST /api/cron/tick — CRON_SECRET-gated (Vercel Cron's Authorization: Bearer <secret>
// convention). Vercel Cron sends GET; POST is kept for manual/local triggering with curl. The
// caller in production is the pg_cron job installed by migration 0008 (D-21), every 5 minutes.
//
// D-61 (2026-09-19) made this the whole trip lifecycle. Nobody starts or closes a trip any more;
// the jobs per tick are:
//
// 1. Departure reminders — any scheduled trip departing within DEPARTURE_REMINDER_LEAD_MINUTES
//    gets a "reminder" notification to its driver and active riders, deduped per trip. A round
//    trip's return leg is a real trip by the time it is due (job 2 created it at the outbound's
//    departure), so "15 minutes before the return" needs no job of its own.
// 2. Settle departed trips — every scheduled trip whose departure has passed is settled
//    (src/lib/api/settleTrip.ts): seats confirmed, driver paid, return leg materialised.
// 3. Parking reminders — PARKING_REMINDER_AFTER_MINUTES after a settled leg departed, its driver is
//    reminded to pay for parking, only when the group has a link for that leg's end (D-54).
//
// Retired by D-61: the close reminder, D-35 mechanic (ii)'s T-2h return-leg close, the 6h
// auto-close and D-23's 24h expiry of unstarted trips. None of them has anything left to do.

// Every notifying job dedupes through this helper. It replaces a `.maybeSingle()` that was actively
// broken: notifyProfiles writes one row *per recipient*, so as soon as a trip had a single rider
// the dedupe query matched more than one row, `.maybeSingle()` answered with an error instead of a
// row, the error was dropped on the floor with only `data` destructured, and the reminder read as
// "never sent" — re-pushing to every phone on the trip on each of the three ticks the 15-minute
// window spans. Asking for at most one row is the whole fix.
async function alreadyNotified(admin: AdminClient, type: "reminder" | "parking", tripId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("notification")
    .select("id")
    .eq("type", type)
    .contains("payload", { tripId })
    .limit(1);

  // A failed lookup must not be read as "not sent yet" — that is how a dedupe turns into a loop.
  // Skipping this trip costs one late reminder; guessing costs a notification every five minutes.
  if (error) return true;
  return (data ?? []).length > 0;
}

// Driver plus everyone actually aboard. Guest riders have no profile_id and no device to push to.
async function tripAudience(admin: AdminClient, tripId: string, driverId: string): Promise<string[]> {
  const { data: riders } = await admin
    .from("trip_rider")
    .select("profile_id")
    .eq("trip_id", tripId)
    .in("state", ["joined", "confirmed"]);
  return [driverId, ...(riders ?? []).map((r) => r.profile_id).filter((pid): pid is string => !!pid)];
}

// One bad row must not take the scheduler down with it.
//
// The jobs below run in sequence in a single request, and until now nothing caught anything:
// one unexpected throw — a malformed row, a transient failure inside settleTrip, an audit insert
// refused by a constraint — aborted the whole tick, so every job *after* it silently did not run.
// And because the next tick five minutes later meets exactly the same data, that is not a blip, it
// is a permanent outage of everything downstream, with no error surfacing anywhere in the app.
//
// This project has already lost weeks to a scheduler that was quietly doing nothing (D-21). So each
// trip is isolated: a failure is recorded against that trip and the sweep moves on, which keeps one
// unprocessable row from costing every other trip its reminder, its settle and its return leg.
async function forEachTrip<T>(rows: T[], failures: string[], label: string, handle: (row: T) => Promise<void>) {
  for (const row of rows) {
    try {
      await handle(row);
    } catch (error) {
      const id = (row as { id?: string }).id ?? "unknown";
      failures.push(`${label}/${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function handleTick(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();
  // Surfaced in the response rather than thrown, so a tick that partly failed reports which trips
  // it could not process instead of looking like a tick that found nothing to do.
  const failures: string[] = [];

  // --- 1. Departure reminders -----------------------------------------------------------------
  // The window is bounded on both sides in SQL and then confirmed by the pure predicate. The lower
  // bound reaches slightly *behind* now: the old query started at `now`, so a trip whose departure
  // slipped past between two five-minute ticks fell out of the window and was never reminded at
  // all. A reminder four minutes late is worth sending; one an hour late is not.
  const windowStart = new Date(now.getTime() - DEPARTURE_REMINDER_GRACE_MINUTES * 60_000).toISOString();
  const windowEnd = new Date(now.getTime() + DEPARTURE_REMINDER_LEAD_MINUTES * 60_000).toISOString();
  const { data: dueTrips } = await admin
    .from("trip")
    .select("id, driver_id, depart_at")
    .eq("status", "scheduled")
    .gte("depart_at", windowStart)
    .lte("depart_at", windowEnd);

  let remindersSent = 0;
  let reminderFailures = 0;
  await forEachTrip(dueTrips ?? [], failures, "reminder", async (trip) => {
    const due = isDepartureReminderDue(
      trip.depart_at,
      now,
      DEPARTURE_REMINDER_LEAD_MINUTES,
      DEPARTURE_REMINDER_GRACE_MINUTES,
    );
    if (!due) return;
    if (await alreadyNotified(admin, "reminder", trip.id)) return;

    const result = await notifyProfiles(await tripAudience(admin, trip.id, trip.driver_id), {
      type: "reminder",
      title: "Trip departing soon",
      body: `Departure is in about ${DEPARTURE_REMINDER_LEAD_MINUTES} minutes.`,
      tripId: trip.id,
    });
    if (result.error) reminderFailures += 1;
    else remindersSent += 1;
  });

  // --- 2. Settle departed trips (D-61) --------------------------------------------------------
  // No lower bound on purpose: a scheduler that was down for a day must still pay yesterday's rides
  // when it comes back. The D-61 rollout cancelled everything unfinished from before this job
  // existed, so there is no backlog of old trips for it to pay by surprise.
  const { data: departedTrips } = await admin
    .from("trip")
    .select("id, depart_at")
    .eq("status", "scheduled")
    .lte("depart_at", now.toISOString())
    // Oldest first: an outbound always settles before the return leg it creates.
    .order("depart_at", { ascending: true });

  let settled = 0;
  await forEachTrip(departedTrips ?? [], failures, "settle", async (trip) => {
    if (!isSettleDue(trip.depart_at, now)) return;
    const result = await settleTrip(trip.id, now);
    if (!result.ok) {
      // A lost race (another tick got there first) is not a failure — anything else is, and it
      // must reach cron_tick_failures rather than retrying silently forever the way D-60 did.
      if (result.error !== "wrong_status") failures.push(`settle/${trip.id}: ${result.error} ${result.message ?? ""}`.trim());
      return;
    }

    await admin.from("audit_log").insert({
      actor_profile_id: null,
      action: "cron_settle_trip",
      entity_type: "trip",
      entity_id: trip.id,
      after: {
        status: "closed",
        seatsFilled: result.seatsFilled,
        pointsAwarded: result.pointsAwarded,
        backTripId: result.backTripId,
      },
    });
    settled += 1;
  });

  // --- 3. Parking reminders (D-61) -------------------------------------------------------------
  // Bounded in SQL to the legs that departed inside the reminder window, then confirmed by the pure
  // predicate. Only the driver pays for parking, so only the driver is told.
  const parkingFrom = new Date(
    now.getTime() - (PARKING_REMINDER_AFTER_MINUTES + PARKING_REMINDER_GRACE_MINUTES) * 60_000,
  ).toISOString();
  const parkingTo = new Date(now.getTime() - PARKING_REMINDER_AFTER_MINUTES * 60_000).toISOString();
  const { data: parkedTrips } = await admin
    .from("trip")
    .select("id, driver_id, depart_at, direction, group:group_id(parking_url_out, parking_url_back)")
    .eq("status", "closed")
    .gte("depart_at", parkingFrom)
    .lte("depart_at", parkingTo);

  let parkingRemindersSent = 0;
  await forEachTrip(parkedTrips ?? [], failures, "parking", async (trip) => {
    if (!isParkingReminderDue(trip.depart_at, now, PARKING_REMINDER_AFTER_MINUTES, PARKING_REMINDER_GRACE_MINUTES)) return;
    const group = Array.isArray(trip.group) ? trip.group[0] : trip.group;
    const url = group
      ? parkingUrlForLeg(trip.direction, { parkingUrlOut: group.parking_url_out, parkingUrlBack: group.parking_url_back })
      : null;
    // Developer, 2026-09-19: only when a link exists — a leg with nothing to pay stays quiet.
    if (!url) return;
    if (await alreadyNotified(admin, "parking", trip.id)) return;

    const result = await notifyProfiles([trip.driver_id], {
      type: "parking",
      title: "Pay for parking",
      body: "Don't forget to pay for parking. Open the trip for the link.",
      tripId: trip.id,
    });
    if (!result.error) parkingRemindersSent += 1;
  });

  // Isolation without visibility would just be a quieter version of the same bug: a trip that fails
  // every five minutes forever, with the sweep politely stepping over it and nobody ever told. The
  // response body is only ever read by pg_net, which discards it, so the record goes where the
  // tick's other outcomes already go.
  if (failures.length > 0) {
    await admin.from("audit_log").insert({
      actor_profile_id: null,
      action: "cron_tick_failures",
      entity_type: "trip",
      entity_id: null,
      after: { failures, at: now.toISOString() },
    });
  }

  return NextResponse.json({
    // Non-empty means the tick ran but could not process specific trips — the sweep continued past
    // them rather than aborting, so the other jobs still did their work.
    failures,
    remindersSent,
    reminderFailures,
    settled,
    parkingRemindersSent,
  });
}

export const GET = handleTick;
export const POST = handleTick;
