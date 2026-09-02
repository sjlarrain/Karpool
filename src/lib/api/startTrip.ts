import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { transition, type TripTransitionErrorCode } from "@/domain/tripMachine";
import { notifyProfiles } from "@/lib/notify/tripNotify";

// D-50: start opened to the group admin on 2026-09-01, mirroring D-35(i)'s close. Shared by the
// driver's own start (POST /api/trips/:id/start) and the platform admin console's force-start, so
// the two paths cannot drift on who is notified or what counts as "started" the way close's two
// callers were kept in sync by src/lib/api/closeTrip.ts.

export interface StartTripActor {
  profileId?: string;
  isGroupAdmin?: boolean;
}

export interface StartTripSuccess {
  ok: true;
  trip: Record<string, unknown>;
  notifiedRiders: number;
  pushDelivery: { sent: number; configError: string | null };
}

export interface StartTripFailure {
  ok: false;
  error: TripTransitionErrorCode | "not_found" | "update_failed";
  status: number;
  message?: string;
}

export type StartTripResult = StartTripSuccess | StartTripFailure;

const STATUS_BY_TRANSITION_ERROR: Record<TripTransitionErrorCode, number> = {
  not_driver: 403,
  not_permitted: 403,
  wrong_status: 409,
  too_early: 409,
};

export async function startTrip(tripId: string, actor: StartTripActor): Promise<StartTripResult> {
  const admin = createSupabaseAdminClient();

  const { data: trip } = await admin
    .from("trip")
    .select("driver_id, status, depart_at")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) {
    return { ok: false, error: "not_found", status: 404 };
  }

  const result = transition({ status: trip.status, driverId: trip.driver_id, departAt: trip.depart_at }, "start", actor);
  if (!result.ok) {
    return { ok: false, error: result.error, status: STATUS_BY_TRANSITION_ERROR[result.error] };
  }

  const { data: updated, error } = await admin
    .from("trip")
    .update({ status: result.nextStatus, started_at: new Date().toISOString() })
    .eq("id", tripId)
    .select()
    .single();
  if (error || !updated) {
    return { ok: false, error: "update_failed", status: 500, message: error?.message };
  }

  const { data: activeRiders } = await admin
    .from("trip_rider")
    .select("profile_id")
    .eq("trip_id", tripId)
    .in("state", ["joined", "confirmed"]);
  const riderProfileIds = (activeRiders ?? []).map((r) => r.profile_id).filter((pid): pid is string => !!pid);

  const notify = await notifyProfiles(riderProfileIds, {
    type: "start",
    title: "Your driver is on the way",
    body: "The trip has started — get to your pickup spot.",
    tripId,
  });

  return {
    ok: true,
    trip: updated,
    notifiedRiders: notify.notified,
    pushDelivery: { sent: notify.pushed, configError: notify.pushConfigError },
  };
}
