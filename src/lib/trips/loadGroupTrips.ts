import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
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
): Promise<{ ok: true; trips: TripView[] } | { ok: false; error: "not_found" | "lookup_failed" }> {
  const { data: group } = await supabase.from("group").select("origin_label, dest_label").eq("id", groupId).maybeSingle();
  if (!group) {
    return { ok: false, error: "not_found" };
  }

  // Live trips, plus anything closed in the last 24h — a closed trip needs to stay reachable for a
  // while so a rider can actually open it and give kudos; otherwise it vanishes from the feed the
  // instant the driver closes it and the "Rate your ride" prompt (in the trip detail overlay)
  // becomes unreachable (caught by the Phase 9 E2E test — there was no card left to click).
  const recentCutoff = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const { data: trips, error: tripsError } = await supabase
    .from("trip")
    .select("id, direction, depart_at, return_at, capacity, status, driver_id")
    .eq("group_id", groupId)
    .or(`status.in.(scheduled,started),and(status.eq.closed,closed_at.gte.${recentCutoff})`)
    .order("depart_at", { ascending: true });
  if (tripsError) {
    return { ok: false, error: "lookup_failed" };
  }

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
    };

    return toTripView({
      trip: tripInput,
      driver: { id: trip.driver_id, displayName: driver?.display_name ?? "A group member" },
      activeRiders: tripRiders,
      viewerId,
      originLabel: group.origin_label,
      destLabel: group.dest_label,
      now,
    });
  });

  return { ok: true, trips: trips2 };
}
