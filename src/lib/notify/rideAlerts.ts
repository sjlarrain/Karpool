import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyProfiles } from "@/lib/notify/tripNotify";
import { matchRideAlert, rideAlertMessage, RIDE_ALERT_DAYS, type RideAlertPrefs } from "@/domain/rideAlerts";

// D-64. Called once, right after a ride is PUBLISHED (developer: "only when it's matching" — not on
// an edit, a postpone, or a seat freeing up later). Everyone in the ride's group who opted in and
// whose usual time for that day falls within their chosen slack gets one notification. The driver
// never alerts themselves.
//
// Returned, never thrown: the ride is already published by the time this runs, so failing the
// publish over a notification would misreport a success. The count and any error go back in the
// response instead, the same way every other notifier here reports.

export interface RideAlertSendResult {
  alerted: number;
  error: string | null;
}

export async function sendRideAlerts(trip: {
  id: string;
  group_id: string;
  driver_id: string;
  direction: "out" | "back" | "round";
  depart_at: string;
  return_at: string | null;
  capacity: number;
}): Promise<RideAlertSendResult> {
  const admin = createSupabaseAdminClient();

  const { data: members, error: memberError } = await admin
    .from("membership")
    .select("profile_id")
    .eq("group_id", trip.group_id)
    .neq("profile_id", trip.driver_id);
  if (memberError) return { alerted: 0, error: memberError.message };
  const memberIds = (members ?? []).map((m) => m.profile_id);
  if (memberIds.length === 0) return { alerted: 0, error: null };

  const [{ data: prefsRows, error: prefsError }, { data: group }, { data: driver }] = await Promise.all([
    admin.from("ride_alert").select("profile_id, slack_minutes, time_zone, days").eq("enabled", true).in("profile_id", memberIds),
    admin.from("group").select("origin_label, dest_label").eq("id", trip.group_id).maybeSingle(),
    admin.from("profile").select("display_name").eq("id", trip.driver_id).maybeSingle(),
  ]);
  if (prefsError) return { alerted: 0, error: prefsError.message };
  if (!group) return { alerted: 0, error: "group_not_found" };

  // One message per distinct wording: people in the same zone matching the same legs share a text,
  // so the notify call (and its push fan-out) runs once per wording rather than once per person.
  const byMessage = new Map<string, { title: string; body: string; ids: string[] }>();
  for (const row of prefsRows ?? []) {
    const prefs: RideAlertPrefs = {
      enabled: true,
      slackMinutes: row.slack_minutes,
      timeZone: row.time_zone,
      days: row.days as unknown as RideAlertPrefs["days"],
    };
    // A malformed blob must not throw the whole send away for everyone else.
    if (!prefs.days || RIDE_ALERT_DAYS.some((d) => !prefs.days[d])) continue;

    const tripShape = { direction: trip.direction, departAt: trip.depart_at, returnAt: trip.return_at };
    const legs = matchRideAlert(prefs, tripShape);
    if (legs.length === 0) continue;

    const message = rideAlertMessage({
      driverName: driver?.display_name ?? "Someone",
      originLabel: group.origin_label,
      destLabel: group.dest_label,
      seatsFree: trip.capacity,
      timeZone: prefs.timeZone,
      legs,
      trip: tripShape,
    });
    const key = `${message.title}\n${message.body}`;
    const entry = byMessage.get(key) ?? { ...message, ids: [] };
    entry.ids.push(row.profile_id);
    byMessage.set(key, entry);
  }

  let alerted = 0;
  let firstError: string | null = null;
  for (const { title, body, ids } of byMessage.values()) {
    const result = await notifyProfiles(ids, { type: "alert", title, body, tripId: trip.id });
    if (result.error) firstError ??= result.error;
    else alerted += ids.length;
  }
  return { alerted, error: firstError };
}
