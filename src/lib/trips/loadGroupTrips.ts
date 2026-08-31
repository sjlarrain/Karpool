import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { PAST_TRIPS_WINDOW_DAYS } from "@/domain/constants";
import { toTripView } from "@/domain/toTripView";
import type { TripRiderRowInput, TripRowInput } from "@/domain/toTripView";
import type { TripView } from "@/domain/types";

// Shared by GET /api/trips and the Carpools tab's server-rendered initial load — both need the same
// "group's live trip feed, mapped for this viewer" query. Kept out of the route handler so the two
// call sites don't drift.
export async function loadGroupTrips(
  supabase: SupabaseClient<Database>,
  groupId: string,
  viewerId: string,
  now: Date,
  timeZone: string,
): Promise<{ ok: true; trips: TripView[] } | { ok: false; error: "not_found" | "lookup_failed" }> {
  const { data: group } = await supabase.from("group").select("origin_label, dest_label").eq("id", groupId).maybeSingle();
  if (!group) {
    return { ok: false, error: "not_found" };
  }

  // Live trips, plus everything that finished inside the Past window (D-27). A finished trip used
  // to fall out of the feed 24h after closing, which also took the "Rate your ride" prompt with it —
  // the only way to reach that prompt is the trip's own card. Past trips are filtered on depart_at
  // rather than closed_at so a cancelled or expired trip (neither has a closed_at) is covered by the
  // same window.
  const pastCutoff = new Date(now.getTime() - PAST_TRIPS_WINDOW_DAYS * 24 * 3_600_000).toISOString();
  const { data: trips, error: tripsError } = await supabase
    .from("trip")
    .select("id, direction, depart_at, return_at, capacity, status, driver_id, cancelled_reason, out_stop_id, back_stop_id")
    .eq("group_id", groupId)
    .or(`status.in.(scheduled,started),and(status.in.(closed,cancelled),depart_at.gte.${pastCutoff})`)
    .order("depart_at", { ascending: true });
  if (tripsError) {
    return { ok: false, error: "lookup_failed" };
  }

  // D-29: the group's stop places, fetched once and joined in memory. A handful of rows per group,
  // and it keeps the trip query free of an embedded resource keyed on a foreign-key constraint name.
  const { data: stopPlaces, error: stopsError } = await supabase
    .from("pickup_place")
    .select("id, label, icon, address")
    .eq("group_id", groupId)
    .eq("kind", "stop");
  if (stopsError) {
    return { ok: false, error: "lookup_failed" };
  }
  const stopById = new Map((stopPlaces ?? []).map((s) => [s.id, s]));

  const tripIds = (trips ?? []).map((t) => t.id);
  const driverIds = [...new Set((trips ?? []).map((t) => t.driver_id))];

  const [{ data: riders, error: ridersError }, { data: drivers, error: driversError }] = await Promise.all([
    tripIds.length > 0
      ? supabase
          .from("trip_rider")
          .select("trip_id, profile_id, guest_name, state")
          .in("trip_id", tripIds)
          .in("state", ["joined", "confirmed"])
      : Promise.resolve({ data: [], error: null }),
    driverIds.length > 0
      ? supabase.from("profile").select("id, display_name, initials, avatar_color").in("id", driverIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (ridersError || driversError) {
    return { ok: false, error: "lookup_failed" };
  }

  const riderProfileIds = [...new Set((riders ?? []).map((r) => r.profile_id).filter((v): v is string => !!v))];
  const { data: riderProfiles, error: riderProfilesError } =
    riderProfileIds.length > 0
      ? await supabase.from("profile").select("id, display_name, initials, avatar_color").in("id", riderProfileIds)
      : { data: [], error: null };
  if (riderProfilesError) {
    return { ok: false, error: "lookup_failed" };
  }

  const driverById = new Map((drivers ?? []).map((d) => [d.id, d]));
  const riderProfileById = new Map((riderProfiles ?? []).map((p) => [p.id, p]));

  const trips2 = (trips ?? []).map((trip) => {
    const driver = driverById.get(trip.driver_id);
    const tripRiders: TripRiderRowInput[] = (riders ?? [])
      .filter((r) => r.trip_id === trip.id)
      .map((r) => {
        const profile = r.profile_id ? riderProfileById.get(r.profile_id) : undefined;
        return {
          profileId: r.profile_id,
          guestName: r.guest_name,
          displayName: profile?.display_name ?? null,
          initials: profile?.initials ?? null,
          avatarColor: profile?.avatar_color ?? null,
        };
      });

    const tripInput: TripRowInput = {
      id: trip.id,
      direction: trip.direction,
      departAt: trip.depart_at,
      returnAt: trip.return_at,
      capacity: trip.capacity,
      status: trip.status,
      driverId: trip.driver_id,
      cancelledReason: trip.cancelled_reason,
      outStop: trip.out_stop_id ? stopById.get(trip.out_stop_id) ?? null : null,
      backStop: trip.back_stop_id ? stopById.get(trip.back_stop_id) ?? null : null,
    };

    return toTripView({
      trip: tripInput,
      driver: { id: trip.driver_id, displayName: driver?.display_name ?? "A group member" },
      activeRiders: tripRiders,
      viewerId,
      originLabel: group.origin_label,
      destLabel: group.dest_label,
      now,
      timeZone,
    });
  });

  return { ok: true, trips: trips2 };
}
