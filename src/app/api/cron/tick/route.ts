import { NextResponse } from "next/server";
import { env } from "@/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyProfiles } from "@/lib/notify/tripNotify";
import { NOT_STARTED_REASON, UNSTARTED_GRACE_HOURS, RETURN_LEG_LEAD_MINUTES } from "@/domain/constants";
import { isReturnLegDue } from "@/domain/backLeg";
import { closeTrip } from "@/lib/api/closeTrip";

const REMINDER_WINDOW_MINUTES = 15;
const AUTO_CLOSE_AFTER_HOURS = 6;

// GET/POST /api/cron/tick — CRON_SECRET-gated (Vercel Cron's Authorization: Bearer <secret>
// convention). Vercel Cron sends GET; POST is kept for manual/local triggering with curl.
// Two jobs per tick:
//
// 1. Departure reminders — any scheduled trip departing within REMINDER_WINDOW_MINUTES gets a
//    "reminder"-type notification to its driver and active riders, deduped by checking for an
//    existing reminder notification carrying that trip's id in payload (cron runs on an interval,
//    so without this a trip sitting inside the window across multiple ticks would re-notify).
// 2. Auto-close abandoned trips — a trip left "started" for AUTO_CLOSE_AFTER_HOURS is force-closed.
//    This is a safety net, not the real close flow: no driver confirmed who rode, so it never
//    touches points_ledger. Logged to audit_log (actor_profile_id: null marks it as system-acted).
// 3. Generate a round trip's return leg (D-35 mechanic (ii)) — a round trip whose outbound is
//    still "started" RETURN_LEG_LEAD_MINUTES before the return departure is closed by the
//    scheduler, in the same restricted form an admin gets, which pays the driver and materialises
//    the return leg. Without this the leg's existence depends on the driver remembering one tap.
// 4. Expire trips nobody started (D-23) — a scheduled trip stays live for UNSTARTED_GRACE_HOURS
//    past its departure so a driver who forgot to tap Start can still put it right. After that it
//    ends as cancelled with reason NOT_STARTED_REASON, which the UI shows as "Past · never started"
//    rather than "Cancelled" — nobody called this off, it simply never happened. No points and no
//    penalties: an expiry is the absence of a trip, not a rider's fault.
async function handleTick(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();

  const reminderWindowEnd = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60_000).toISOString();
  const { data: dueTrips } = await admin
    .from("trip")
    .select("id, driver_id")
    .eq("status", "scheduled")
    .gte("depart_at", now.toISOString())
    .lte("depart_at", reminderWindowEnd);

  let remindersSent = 0;
  for (const trip of dueTrips ?? []) {
    const { data: existing } = await admin
      .from("notification")
      .select("id")
      .eq("type", "reminder")
      .contains("payload", { tripId: trip.id })
      .maybeSingle();
    if (existing) continue;

    const { data: riders } = await admin
      .from("trip_rider")
      .select("profile_id")
      .eq("trip_id", trip.id)
      .in("state", ["joined", "confirmed"]);
    const recipientIds = [
      trip.driver_id,
      ...(riders ?? []).map((r) => r.profile_id).filter((pid): pid is string => !!pid),
    ];

    await notifyProfiles(recipientIds, {
      type: "reminder",
      title: "Trip departing soon",
      body: `Departure is in about ${REMINDER_WINDOW_MINUTES} minutes.`,
      tripId: trip.id,
    });
    remindersSent += 1;
  }

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

    const { data: riders } = await admin
      .from("trip_rider")
      .select("profile_id")
      .eq("trip_id", trip.id)
      .in("state", ["joined", "confirmed"]);
    const recipientIds = [
      trip.driver_id,
      ...(riders ?? []).map((r) => r.profile_id).filter((pid): pid is string => !!pid),
    ];

    await notifyProfiles(recipientIds, {
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
      after: { status: "cancelled", cancelled_reason: NOT_STARTED_REASON, reason: `never started, ${UNSTARTED_GRACE_HOURS}h past departure` },
    });
    expired += 1;
  }

  return NextResponse.json({ remindersSent, returnLegsGenerated, autoClosed, expired });
}

export const GET = handleTick;
export const POST = handleTick;
