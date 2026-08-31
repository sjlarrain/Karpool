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
} from "@/domain/constants";
import { isReturnLegDue } from "@/domain/backLeg";
import { isDepartureReminderDue } from "@/domain/tripReminders";
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
// 2. Generate a round trip's return leg (D-35 mechanic (ii)) — a round trip whose outbound is
//    still "started" RETURN_LEG_LEAD_MINUTES before the return departure is closed by the
//    scheduler, in the same restricted form an admin gets, which pays the driver and materialises
//    the return leg. Without this the leg's existence depends on the driver remembering one tap.
// 3. Auto-close abandoned trips — a trip left "started" for AUTO_CLOSE_AFTER_HOURS is force-closed.
//    This is a safety net, not the real close flow: no driver confirmed who rode, so it never
//    touches points_ledger. Logged to audit_log (actor_profile_id: null marks it as system-acted).
// 4. Expire trips nobody started (D-23) — a scheduled trip stays live for UNSTARTED_GRACE_HOURS
//    past its departure so a driver who forgot to tap Start can still put it right. After that it
//    ends as cancelled with reason NOT_STARTED_REASON, which the UI shows as "Past · never started"
//    rather than "Cancelled". No points and no penalties: an expiry is the absence of a trip.

// Every notifying job dedupes through this helper. It replaces a `.maybeSingle()` that was actively
// broken: notifyProfiles writes one row *per recipient*, so as soon as a trip had a single rider
// the dedupe query matched more than one row, `.maybeSingle()` answered with an error instead of a
// row, the error was dropped on the floor with only `data` destructured, and the reminder read as
// "never sent" — re-pushing to every phone on the trip on each of the three ticks the 15-minute
// window spans. Asking for at most one row is the whole fix.
async function alreadyNotified(admin: AdminClient, type: "reminder", tripId: string): Promise<boolean> {
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

async function handleTick(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();

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
  for (const trip of dueTrips ?? []) {
    const due = isDepartureReminderDue(
      trip.depart_at,
      now,
      DEPARTURE_REMINDER_LEAD_MINUTES,
      DEPARTURE_REMINDER_GRACE_MINUTES,
    );
    if (!due) continue;
    if (await alreadyNotified(admin, "reminder", trip.id)) continue;

    const result = await notifyProfiles(await tripAudience(admin, trip.id, trip.driver_id), {
      type: "reminder",
      title: "Trip departing soon",
      body: `Departure is in about ${DEPARTURE_REMINDER_LEAD_MINUTES} minutes.`,
      tripId: trip.id,
    });
    if (result.error) reminderFailures += 1;
    else remindersSent += 1;
  }

  // --- 2. Return legs -------------------------------------------------------------------------
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

  for (const trip of pendingReturns ?? []) {
    if (!trip.return_at) continue;

    // Already materialised by a driver or admin close on an earlier tick — nothing owed.
    const { data: existingLeg } = await admin.from("trip").select("id").eq("parent_trip_id", trip.id).maybeSingle();
    if (existingLeg) continue;

    if (!isReturnLegDue(trip.return_at, now, RETURN_LEG_LEAD_MINUTES)) {
      // Not due yet — but the auto-close must not get to it first.
      deferredFromAutoClose.add(trip.id);
      continue;
    }

    const result = await closeTrip({ tripId: trip.id, actor: { isSystem: true } });
    if (!result.ok) {
      deferredFromAutoClose.add(trip.id);
      continue;
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
  }

  // --- 3. Auto-close abandoned trips -----------------------------------------------------------
  const staleBefore = new Date(now.getTime() - AUTO_CLOSE_AFTER_HOURS * 3_600_000).toISOString();
  const { data: staleTrips } = await admin.from("trip").select("id").eq("status", "started").lte("started_at", staleBefore);

  let autoClosed = 0;
  for (const trip of staleTrips ?? []) {
    // A round trip still owed a return leg belongs to mechanic (ii), which will close it properly
    // and pay for it. Closing it here for zero points would strand the return.
    if (deferredFromAutoClose.has(trip.id)) continue;
    await admin.from("trip").update({ status: "closed", closed_at: now.toISOString() }).eq("id", trip.id);
    await admin.from("audit_log").insert({
      actor_profile_id: null,
      action: "cron_auto_close",
      entity_type: "trip",
      entity_id: trip.id,
      after: { status: "closed", reason: `started_at older than ${AUTO_CLOSE_AFTER_HOURS}h` },
    });
    autoClosed += 1;
  }

  // --- 4. Expire trips nobody started ----------------------------------------------------------
  const expireBefore = new Date(now.getTime() - UNSTARTED_GRACE_HOURS * 3_600_000).toISOString();
  const { data: expiredTrips } = await admin
    .from("trip")
    .select("id, driver_id")
    .eq("status", "scheduled")
    .lte("depart_at", expireBefore);

  let expired = 0;
  for (const trip of expiredTrips ?? []) {
    const { error: expireError } = await admin
      .from("trip")
      .update({ status: "cancelled", cancelled_reason: NOT_STARTED_REASON })
      .eq("id", trip.id)
      // Guard against a driver starting the trip between the select and this update — without it
      // the sweep would cancel a ride that is under way.
      .eq("status", "scheduled");
    if (expireError) continue;

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
  }

  return NextResponse.json({
    remindersSent,
    reminderFailures,
    returnLegsGenerated,
    autoClosed,
    expired,
  });
}

export const GET = handleTick;
export const POST = handleTick;
