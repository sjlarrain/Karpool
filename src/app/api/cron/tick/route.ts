import { NextResponse } from "next/server";
import { env } from "@/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyProfiles } from "@/lib/notify/tripNotify";

const REMINDER_WINDOW_MINUTES = 15;
const AUTO_CLOSE_AFTER_HOURS = 6;

// POST /api/cron/tick — CRON_SECRET-gated (Vercel Cron's Authorization: Bearer <secret>
// convention). Two jobs per tick:
//
// 1. Departure reminders — any scheduled trip departing within REMINDER_WINDOW_MINUTES gets a
//    "reminder"-type notification to its driver and active riders, deduped by checking for an
//    existing reminder notification carrying that trip's id in payload (cron runs on an interval,
//    so without this a trip sitting inside the window across multiple ticks would re-notify).
// 2. Auto-close abandoned trips — a trip left "started" for AUTO_CLOSE_AFTER_HOURS is force-closed.
//    This is a safety net, not the real close flow: no driver confirmed who rode, so it never
//    touches points_ledger. Logged to audit_log (actor_profile_id: null marks it as system-acted).
export async function POST(request: Request) {
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

  const staleBefore = new Date(now.getTime() - AUTO_CLOSE_AFTER_HOURS * 3_600_000).toISOString();
  const { data: staleTrips } = await admin.from("trip").select("id").eq("status", "started").lte("started_at", staleBefore);

  let autoClosed = 0;
  for (const trip of staleTrips ?? []) {
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

  return NextResponse.json({ remindersSent, autoClosed });
}
