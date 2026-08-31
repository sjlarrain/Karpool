import { NextResponse } from "next/server";
import { env } from "@/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyProfiles } from "@/lib/notify/tripNotify";
import {
  NOT_STARTED_REASON,
  UNSTARTED_GRACE_HOURS,
  RETURN_LEG_LEAD_MINUTES,
  DEPARTURE_REMINDER_LEAD_MINUTES,
  DEPARTURE_REMINDER_GRACE_MINUTES,
  CLOSE_REMINDER_AFTER_MINUTES,
} from "@/domain/constants";
import { isReturnLegDue } from "@/domain/backLeg";
import { isDepartureReminderDue, isCloseReminderDue } from "@/domain/tripReminders";
import { closeTrip } from "@/lib/api/closeTrip";

const AUTO_CLOSE_AFTER_HOURS = 6;

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

// GET/POST /api/cron/tick — CRON_SECRET-gated (Vercel Cron's Authorization: Bearer <secret>
// convention). Vercel Cron sends GET; POST is kept for manual/local triggering with curl. The
// caller in production is the pg_cron job installed by migration 0008 (D-21).
//
// Jobs per tick:
//
// 1. Departure reminders — any scheduled trip departing within DEPARTURE_REMINDER_LEAD_MINUTES
//    gets a "reminder" notification to its driver and active riders, deduped against an existing
//    reminder row carrying that trip's id.
// 2. Close reminders — a trip left "started" for CLOSE_REMINDER_AFTER_MINUTES nudges its driver to
//    close it. Closing is the only thing that writes points_ledger, so until it happens the ride
//    has paid nobody; the 6h auto-close below is a tidier, not a substitute, because it awards
//    nothing at all.
// 3. Generate a round trip's return leg (D-35 mechanic (ii)) — a round trip whose outbound is
//    still "started" RETURN_LEG_LEAD_MINUTES before the return departure is closed by the
//    scheduler, in the same restricted form an admin gets, which pays the driver and materialises
//    the return leg. Without this the leg's existence depends on the driver remembering one tap.
// 4. Auto-close abandoned trips — a trip left "started" for AUTO_CLOSE_AFTER_HOURS is force-closed.
//    This is a safety net, not the real close flow: no driver confirmed who rode, so it never
//    touches points_ledger. Logged to audit_log (actor_profile_id: null marks it as system-acted).
// 5. Expire trips nobody started (D-23) — a scheduled trip stays live for UNSTARTED_GRACE_HOURS
//    past its departure so a driver who forgot to tap Start can still put it right. After that it
//    ends as cancelled with reason NOT_STARTED_REASON, which the UI shows as "Past · never started"
//    rather than "Cancelled". No points and no penalties: an expiry is the absence of a trip.

// Every notifying job dedupes through this helper. It replaces a `.maybeSingle()` that was actively
// broken: notifyProfiles writes one row *per recipient*, so as soon as a trip had a single rider
// the dedupe query matched more than one row, `.maybeSingle()` answered with an error instead of a
// row, the error was dropped on the floor with only `data` destructured, and the reminder read as
// "never sent" — re-pushing to every phone on the trip on each of the three ticks the 15-minute
// window spans. Asking for at most one row is the whole fix.
async function alreadyNotified(admin: AdminClient, type: "reminder" | "close_reminder", tripId: string): Promise<boolean> {
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
// The five jobs below run in sequence in a single request, and until now nothing caught anything:
// one unexpected throw — a malformed row, a transient failure inside closeTrip, an audit insert
// refused by a constraint — aborted the whole tick, so every job *after* it silently did not run.
// And because the next tick five minutes later meets exactly the same data, that is not a blip, it
// is a permanent outage of everything downstream, with no error surfacing anywhere in the app.
//
// This project has already lost weeks to a scheduler that was quietly doing nothing (D-21). So each
// trip is isolated: a failure is recorded against that trip and the sweep moves on, which keeps one
// unprocessable row from costing every other trip its reminder, its return leg and its expiry.
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

  // --- 2. Close reminders ---------------------------------------------------------------------
  // Only the driver is nudged: they are the only person who can close a trip, so telling the riders
  // their points are stuck would be noise they cannot act on.
  const { data: openTrips } = await admin.from("trip").select("id, driver_id, started_at").eq("status", "started");

  let closeRemindersSent = 0;
  let closeReminderFailures = 0;
  await forEachTrip(openTrips ?? [], failures, "close_reminder", async (trip) => {
    if (!isCloseReminderDue(trip.started_at, now, CLOSE_REMINDER_AFTER_MINUTES)) return;
    if (await alreadyNotified(admin, "close_reminder", trip.id)) return;

    const result = await notifyProfiles([trip.driver_id], {
      type: "close_reminder",
      title: "Close your trip",
      body: "This ride is still open. Close it to confirm who came along and hand out the points.",
      tripId: trip.id,
    });
    if (result.error) closeReminderFailures += 1;
    else closeRemindersSent += 1;
  });

  // --- 3. Return legs -------------------------------------------------------------------------
  // D-35 mechanic (ii) runs BEFORE the 6h auto-close, and the auto-close then skips any round trip
  // still owed a return leg. The ordering matters: on a normal commute the 6h mark arrives first
  // (out at 08:00, back at 18:00 — stale at 14:00, due at 16:00), so without this the auto-close
  // would reach the trip first, close it for zero points, and leave the return leg unbuilt. That is
  // precisely the failure this mechanic exists to prevent, arriving through the other door.
  const { data: pendingReturns } = await admin
    .from("trip")
    .select("id, driver_id, return_at, parent_trip_id")
    .eq("status", "started")
    .eq("direction", "round")
    .not("return_at", "is", null);

  const deferredFromAutoClose = new Set<string>();
  let returnLegsGenerated = 0;

  await forEachTrip(pendingReturns ?? [], failures, "return_leg", async (trip) => {
    if (!trip.return_at) return;

    // Already materialised by a driver or admin close on an earlier tick — nothing owed.
    const { data: existingLeg } = await admin.from("trip").select("id").eq("parent_trip_id", trip.id).maybeSingle();
    if (existingLeg) return;

    if (!isReturnLegDue(trip.return_at, now, RETURN_LEG_LEAD_MINUTES)) {
      // Not due yet — but the auto-close must not get to it first.
      deferredFromAutoClose.add(trip.id);
      return;
    }

    const result = await closeTrip({ tripId: trip.id, actor: { isSystem: true } });
    if (!result.ok) {
      deferredFromAutoClose.add(trip.id);
      return;
    }

    await admin.from("audit_log").insert({
      actor_profile_id: null,
      action: "cron_generate_return_leg",
      entity_type: "trip",
      entity_id: trip.id,
      after: {
        status: "closed",
        mode: result.mode,
        confirmedCount: result.confirmedCount,
        pointsAwarded: result.pointsAwarded,
        backTripId: result.backTripId,
        reason: `return departs within ${RETURN_LEG_LEAD_MINUTES}m and nobody closed the outbound`,
      },
    });
    returnLegsGenerated += 1;
  });

  // --- 4. Auto-close abandoned trips -----------------------------------------------------------
  const staleBefore = new Date(now.getTime() - AUTO_CLOSE_AFTER_HOURS * 3_600_000).toISOString();
  const { data: staleTrips } = await admin.from("trip").select("id").eq("status", "started").lte("started_at", staleBefore);

  let autoClosed = 0;
  await forEachTrip(staleTrips ?? [], failures, "auto_close", async (trip) => {
    // A round trip still owed a return leg belongs to mechanic (ii), which will close it properly
    // and pay for it. Closing it here for zero points would strand the return.
    if (deferredFromAutoClose.has(trip.id)) return;
    await admin.from("trip").update({ status: "closed", closed_at: now.toISOString() }).eq("id", trip.id);
    await admin.from("audit_log").insert({
      actor_profile_id: null,
      action: "cron_auto_close",
      entity_type: "trip",
      entity_id: trip.id,
      after: { status: "closed", reason: `started_at older than ${AUTO_CLOSE_AFTER_HOURS}h` },
    });
    autoClosed += 1;
  });

  // --- 5. Expire trips nobody started ----------------------------------------------------------
  const expireBefore = new Date(now.getTime() - UNSTARTED_GRACE_HOURS * 3_600_000).toISOString();
  const { data: expiredTrips } = await admin
    .from("trip")
    .select("id, driver_id")
    .eq("status", "scheduled")
    .lte("depart_at", expireBefore);

  let expired = 0;
  await forEachTrip(expiredTrips ?? [], failures, "expire", async (trip) => {
    const { error: expireError } = await admin
      .from("trip")
      .update({ status: "cancelled", cancelled_reason: NOT_STARTED_REASON })
      .eq("id", trip.id)
      // Guard against a driver starting the trip between the select and this update — without it
      // the sweep would cancel a ride that is under way.
      .eq("status", "scheduled");
    if (expireError) return;

    await notifyProfiles(await tripAudience(admin, trip.id, trip.driver_id), {
      type: "change",
      title: "Trip moved to Past",
      body: `It was never started, so it closed itself ${UNSTARTED_GRACE_HOURS}h after departure. No points were awarded.`,
      tripId: trip.id,
    });

    await admin.from("audit_log").insert({
      actor_profile_id: null,
      action: "cron_expire_unstarted",
      entity_type: "trip",
      entity_id: trip.id,
      after: {
        status: "cancelled",
        cancelled_reason: NOT_STARTED_REASON,
        reason: `never started, ${UNSTARTED_GRACE_HOURS}h past departure`,
      },
    });
    expired += 1;
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
    closeRemindersSent,
    closeReminderFailures,
    returnLegsGenerated,
    autoClosed,
    expired,
  });
}

export const GET = handleTick;
export const POST = handleTick;
