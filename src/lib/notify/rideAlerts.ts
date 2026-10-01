import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyProfiles } from "@/lib/notify/tripNotify";
import {
  matchRideAlert,
  rideAlertMessage,
  shouldAlertSeatOpened,
  RIDE_ALERT_DAYS,
  type RideAlertPrefs,
} from "@/domain/rideAlerts";

// D-64. Two moments tell people whose usual time a ride fits:
//
//   1. a ride is PUBLISHED with free seats (sendRideAlerts), and
//   2. a FULL ride gets a seat back (sendSeatOpenedAlerts) — a rider leaves, the driver takes a seat
//      back or frees a guest's, or the driver adds seats. Developer, 2026-09-30: "the idea that a
//      new seat is available works for them".
//
// Everyone in the ride's group who opted in and whose usual time for that day falls within their
// chosen slack gets one notification. The driver never alerts themselves.
//
// Returned, never thrown: by the time this runs the thing it describes has already happened, so
// failing the caller's request would misreport a success. The count and any error go back in the
// response instead, the same way every other notifier here reports.

export interface RideAlertSendResult {
  alerted: number;
  error: string | null;
}

type AlertTrip = {
  id: string;
  group_id: string;
  driver_id: string;
  direction: "out" | "back" | "round";
  depart_at: string;
  return_at: string | null;
  capacity: number;
};

const SEAT_ALERT_TITLE = "A seat opened at your usual time";
// The same person is not told twice about the same ride's seats inside this window — a seat that
// keeps being taken and given back would otherwise ring their phone every few minutes.
const SEAT_ALERT_QUIET_MINUTES = 60;

async function alertMatching(
  trip: AlertTrip,
  opts: { kind: "published" | "seat"; seatsFree: number; excludeProfileIds: string[] },
): Promise<RideAlertSendResult> {
  const admin = createSupabaseAdminClient();

  const { data: members, error: memberError } = await admin
    .from("membership")
    .select("profile_id")
    .eq("group_id", trip.group_id)
    .neq("profile_id", trip.driver_id);
  if (memberError) return { alerted: 0, error: memberError.message };
  const skip = new Set(opts.excludeProfileIds);
  const memberIds = (members ?? []).map((m) => m.profile_id).filter((id) => !skip.has(id));
  if (memberIds.length === 0) return { alerted: 0, error: null };

  const [{ data: prefsRows, error: prefsError }, { data: group }, { data: driver }] = await Promise.all([
    admin.from("ride_alert").select("profile_id, slack_minutes, time_zone, days").eq("enabled", true).in("profile_id", memberIds),
    admin.from("group").select("origin_label, dest_label").eq("id", trip.group_id).maybeSingle(),
    admin.from("profile").select("display_name").eq("id", trip.driver_id).maybeSingle(),
  ]);
  if (prefsError) return { alerted: 0, error: prefsError.message };
  if (!group) return { alerted: 0, error: "group_not_found" };

  // Anyone already told about this ride's seats recently stays quiet.
  const recentlyTold = new Set<string>();
  if (opts.kind === "seat" && (prefsRows ?? []).length > 0) {
    const since = new Date(Date.now() - SEAT_ALERT_QUIET_MINUTES * 60_000).toISOString();
    const { data: recent } = await admin
      .from("notification")
      .select("profile_id")
      .eq("type", "alert")
      .eq("title", SEAT_ALERT_TITLE)
      .contains("payload", { tripId: trip.id })
      .gte("created_at", since)
      .in("profile_id", (prefsRows ?? []).map((r) => r.profile_id));
    for (const row of recent ?? []) recentlyTold.add(row.profile_id);
  }

  // One message per distinct wording: people in the same zone matching the same legs share a text,
  // so the notify call (and its push fan-out) runs once per wording rather than once per person.
  const byMessage = new Map<string, { title: string; body: string; ids: string[] }>();
  for (const row of prefsRows ?? []) {
    if (recentlyTold.has(row.profile_id)) continue;
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
      seatsFree: opts.seatsFree,
      timeZone: prefs.timeZone,
      legs,
      trip: tripShape,
      kind: opts.kind,
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

/** A ride has just been published: tell whoever usually travels at this time. Every seat is free. */
export function sendRideAlerts(trip: AlertTrip): Promise<RideAlertSendResult> {
  return alertMatching(trip, { kind: "published", seatsFree: trip.capacity, excludeProfileIds: [] });
}

/**
 * Seats held on a ride right now, read BEFORE a change that might free one, so the caller can say
 * whether the ride was full. Null when it can't be read — which then reads as "not full", so a
 * failed lookup costs one missed alert and never a wrong one.
 */
export async function seatSnapshot(tripId: string): Promise<{ full: boolean } | null> {
  const admin = createSupabaseAdminClient();
  const [{ data: trip }, { count }] = await Promise.all([
    admin.from("trip").select("capacity").eq("id", tripId).maybeSingle(),
    admin
      .from("trip_rider")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", tripId)
      .in("state", ["joined", "confirmed"]),
  ]);
  if (!trip || count === null) return null;
  return { full: count >= trip.capacity };
}

/**
 * A seat may just have opened on `tripId`. `wasFull` comes from a seatSnapshot taken before the
 * change; everything else is read fresh here. `excludeProfileIds` is for the person whose own seat
 * it was — they are not told about the seat they just gave up. Anyone still holding a seat is left
 * out too: they are already aboard.
 */
export async function sendSeatOpenedAlerts(
  tripId: string,
  opts: { wasFull: boolean; excludeProfileIds?: string[] },
): Promise<RideAlertSendResult> {
  if (!opts.wasFull) return { alerted: 0, error: null };
  const admin = createSupabaseAdminClient();

  const { data: trip, error } = await admin
    .from("trip")
    .select("id, group_id, driver_id, direction, depart_at, return_at, capacity, status")
    .eq("id", tripId)
    .maybeSingle();
  if (error) return { alerted: 0, error: error.message };
  if (!trip) return { alerted: 0, error: "trip_not_found" };

  const { data: seated, error: seatError } = await admin
    .from("trip_rider")
    .select("profile_id")
    .eq("trip_id", tripId)
    .in("state", ["joined", "confirmed"]);
  if (seatError) return { alerted: 0, error: seatError.message };

  const seatsFree = trip.capacity - (seated ?? []).length;
  if (!shouldAlertSeatOpened({ status: trip.status, departAt: trip.depart_at, now: new Date(), wasFull: true, seatsFree })) {
    return { alerted: 0, error: null };
  }

  const aboard = (seated ?? []).map((r) => r.profile_id).filter((id): id is string => !!id);
  return alertMatching(trip, {
    kind: "seat",
    seatsFree,
    excludeProfileIds: [...aboard, ...(opts.excludeProfileIds ?? [])],
  });
}
