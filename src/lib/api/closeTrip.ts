import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { transition, type CloseMode, type TripTransitionErrorCode } from "@/domain/tripMachine";
import { computeCloseAwards, computeNoShowPenalty } from "@/domain/points";
import { shouldGenerateBackLeg, kudosPromptTargets, rideRiderCount } from "@/domain/backLeg";
import { notifyProfiles } from "@/lib/notify/tripNotify";

// D-35 made close the hinge of the whole round-trip design: it is what materialises the return
// leg, so it can no longer live only in the driver's route. Three callers share this — the
// driver's close, a group admin closing a ride the driver forgot, and the platform admin doing the
// same from the console — and they must agree exactly on who gets confirmed, who gets paid, and
// which riders are asked for kudos. Keeping one copy is the only way that stays true.
//
// Riders deliberately cannot close (developer, 2026-08-30). A close decides who rode and moves
// points; that is the driver's authority, or the admin's, and not one passenger's over another's.

export interface CloseTripActor {
  profileId?: string;
  isGroupAdmin?: boolean;
  // D-35 mechanic (ii). The scheduler gets the same restricted close as the admin: it confirms
  // everyone and penalises nobody, because it was not there either.
  isSystem?: boolean;
}

export interface CloseTripInput {
  tripId: string;
  actor: CloseTripActor;
  // Driver-only inputs. A restricted close ignores both: it confirms every active rider and can
  // name nobody a no-show, because only the driver was there to judge who actually rode.
  confirmedTripRiderIds?: string[];
  guestNames?: string[];
}

export interface CloseTripSuccess {
  ok: true;
  mode: CloseMode;
  trip: Record<string, unknown>;
  confirmedCount: number;
  noShowCount: number;
  pointsAwarded: number;
  // The return leg this close materialised, if the trip was a round trip. Null for a one-way, and
  // for a round trip whose leg already existed the id of that existing leg — generate_back_trip()
  // is idempotent, so a second close attempt never produces a second leg.
  backTripId: string | null;
  backTripSeatedProfileIds: string[];
}

export interface CloseTripFailure {
  ok: false;
  error: TripTransitionErrorCode | "not_found" | "rider_lookup_failed" | "confirm_failed" | "no_show_failed" | "guest_add_failed" | "back_leg_failed" | "ledger_write_failed" | "update_failed";
  status: number;
  message?: string;
}

export type CloseTripResult = CloseTripSuccess | CloseTripFailure;

const STATUS_BY_TRANSITION_ERROR: Record<TripTransitionErrorCode, number> = {
  not_driver: 403,
  not_permitted: 403,
  wrong_status: 409,
  too_early: 409,
};

export async function closeTrip({ tripId, actor, confirmedTripRiderIds = [], guestNames = [] }: CloseTripInput): Promise<CloseTripResult> {
  const admin = createSupabaseAdminClient();

  const { data: trip } = await admin
    .from("trip")
    .select("id, driver_id, status, depart_at, group_id, direction, return_at, parent_trip_id")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) {
    return { ok: false, error: "not_found", status: 404 };
  }

  const result = transition({ status: trip.status, driverId: trip.driver_id, departAt: trip.depart_at }, "close", actor);
  if (!result.ok) {
    return { ok: false, error: result.error, status: STATUS_BY_TRANSITION_ERROR[result.error] };
  }
  const mode: CloseMode = result.closeMode ?? "full";

  const { data: group } = await admin
    .from("group")
    .select("drive_weight, pool_weight, pool_step, no_show_penalty")
    .eq("id", trip.group_id)
    .maybeSingle();
  if (!group) {
    return { ok: false, error: "not_found", status: 404 };
  }

  const { data: activeRiders, error: ridersError } = await admin
    .from("trip_rider")
    .select("id, profile_id")
    .eq("trip_id", tripId)
    .in("state", ["joined", "confirmed"]);
  if (ridersError) {
    return { ok: false, error: "rider_lookup_failed", status: 500, message: ridersError.message };
  }

  const active = activeRiders ?? [];
  const activeById = new Map(active.map((r) => [r.id, r]));

  // The one behavioural difference between the two close forms. A restricted close confirms
  // everyone and charges nobody: it exists so a forgotten ride still pays the driver and still
  // generates the return leg, not so an admin ends up adjudicating who showed up for a ride they
  // were not on.
  const confirmedIds = mode === "full" ? confirmedTripRiderIds.filter((rid) => activeById.has(rid)) : active.map((r) => r.id);
  const noShowIds = mode === "full" ? active.map((r) => r.id).filter((rid) => !confirmedIds.includes(rid)) : [];
  const namedGuests = mode === "full" ? guestNames : [];

  const confirmedProfileIds = confirmedIds
    .map((rid) => activeById.get(rid)?.profile_id)
    .filter((pid): pid is string => !!pid);

  if (confirmedIds.length > 0) {
    const { error } = await admin.from("trip_rider").update({ state: "confirmed" }).in("id", confirmedIds);
    if (error) return { ok: false, error: "confirm_failed", status: 500, message: error.message };
  }
  if (noShowIds.length > 0) {
    const { error } = await admin.from("trip_rider").update({ state: "no_show" }).in("id", noShowIds);
    if (error) return { ok: false, error: "no_show_failed", status: 500, message: error.message };
  }

  let insertedGuests: { id: string; guest_name: string | null }[] = [];
  if (namedGuests.length > 0) {
    const { data, error } = await admin
      .from("trip_rider")
      .insert(namedGuests.map((guestName) => ({ trip_id: tripId, guest_name: guestName, state: "confirmed" as const })))
      .select("id, guest_name");
    if (error) return { ok: false, error: "guest_add_failed", status: 500, message: error.message };
    insertedGuests = data ?? [];
  }

  // D-35: the return leg is materialised HERE, before the ledger is written and before the status
  // flips. That ordering is deliberate. generate_back_trip() is idempotent and confirming riders is
  // idempotent, so a failure at this point leaves a retryable close with no points written; doing
  // it after the status update would leave a closed trip that can never be closed again and whose
  // return leg does not exist — the stranded-rider case the whole design exists to prevent.
  let backTripId: string | null = null;
  let backTripSeatedProfileIds: string[] = [];
  if (shouldGenerateBackLeg({ direction: trip.direction, returnAt: trip.return_at })) {
    const { data: backTrip, error: backError } = await admin.rpc("generate_back_trip", { p_parent_trip_id: tripId });
    if (backError) {
      return { ok: false, error: "back_leg_failed", status: 500, message: backError.message };
    }
    const generated = Array.isArray(backTrip) ? backTrip[0] : backTrip;
    if (generated?.id) {
      backTripId = generated.id;
      const { data: seated } = await admin
        .from("trip_rider")
        .select("profile_id")
        .eq("trip_id", generated.id)
        .in("state", ["joined", "confirmed"]);
      backTripSeatedProfileIds = (seated ?? []).map((r) => r.profile_id).filter((pid): pid is string => !!pid);
    }
  }

  const { data: confirmedProfiles } =
    confirmedProfileIds.length > 0
      ? await admin.from("profile").select("id, display_name").in("id", confirmedProfileIds)
      : { data: [] as { id: string; display_name: string }[] };
  const nameByProfileId = new Map((confirmedProfiles ?? []).map((p) => [p.id, p.display_name]));

  const riderNames = [
    ...confirmedProfileIds.map((pid) => nameByProfileId.get(pid) ?? "A rider"),
    ...insertedGuests.map((g) => g.guest_name ?? "Guest"),
  ];

  // D-35 answer (A): every close pays, whoever tapped it. A leg that was driven is a leg that was
  // driven, and the driver should not lose the award because they forgot the last tap.
  const awards = computeCloseAwards(riderNames, {
    driveWeight: group.drive_weight,
    poolWeight: group.pool_weight,
    poolStep: group.pool_step,
  });

  const noShowProfileIds = noShowIds
    .map((rid) => activeById.get(rid)?.profile_id)
    .filter((pid): pid is string => !!pid);
  const noShowPenalty = computeNoShowPenalty(group.no_show_penalty);

  const { error: ledgerError } = await admin.from("points_ledger").insert([
    ...awards.map((award) => ({
      profile_id: trip.driver_id,
      group_id: trip.group_id,
      trip_id: tripId,
      kind: award.kind,
      points: award.points,
      reason: award.reason,
    })),
    ...noShowProfileIds.map((pid) => ({
      profile_id: pid,
      group_id: trip.group_id,
      trip_id: tripId,
      kind: noShowPenalty.kind,
      points: noShowPenalty.points,
      reason: noShowPenalty.reason,
    })),
  ]);
  if (ledgerError) {
    return { ok: false, error: "ledger_write_failed", status: 500, message: ledgerError.message };
  }

  // D-35 answer (B): kudos is once per rider per ride. Riders carried on to the return leg are not
  // asked yet — their ride is not over — so only the ones stopping here get the prompt.
  await notifyProfiles(kudosPromptTargets({ confirmedProfileIds, seatedOnBackLegProfileIds: backTripSeatedProfileIds }), {
    type: "rate",
    title: "Trip closed — leave kudos",
    body: "Rate your driver's ride and award points.",
    tripId,
  });

  if (backTripId && backTripSeatedProfileIds.length > 0) {
    await notifyProfiles(backTripSeatedProfileIds, {
      type: "change",
      title: "Your ride home is ready",
      body: "The return leg is published — your seat is held.",
      tripId: backTripId,
    });
  }

  const { data: updated, error } = await admin
    .from("trip")
    .update({ status: result.nextStatus, closed_at: new Date().toISOString() })
    .eq("id", tripId)
    .select()
    .single();

  if (error || !updated) {
    return { ok: false, error: "update_failed", status: 500, message: error?.message };
  }

  return {
    ok: true,
    mode,
    trip: updated,
    confirmedCount: confirmedProfileIds.length + insertedGuests.length,
    noShowCount: noShowIds.length,
    pointsAwarded: awards.reduce((sum, a) => sum + a.points, 0),
    backTripId,
    backTripSeatedProfileIds,
  };
}

/**
 * D-35 answer (B): how full the car was, for the kudos multiplier, across BOTH legs of a ride.
 * A rider gives kudos on the leg where their ride ended, so on a round trip that is usually the
 * return — and the return is often the emptier leg. Scaling by it alone would pay the driver less
 * for a fuller ride, which is backwards.
 */
export async function confirmedRiderCountForRide(tripId: string): Promise<number> {
  const admin = createSupabaseAdminClient();

  const { data: trip } = await admin.from("trip").select("id, parent_trip_id").eq("id", tripId).maybeSingle();
  if (!trip) return 1;

  const countFor = async (id: string) => {
    const { count } = await admin
      .from("trip_rider")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", id)
      .eq("state", "confirmed");
    return count ?? 0;
  };

  const thisLeg = await countFor(tripId);

  // The sibling is the parent if this is a back leg, or the generated back leg if this is the
  // outbound. Either way there is at most one, enforced by trip_one_back_leg_per_parent.
  let siblingId = trip.parent_trip_id as string | null;
  if (!siblingId) {
    const { data: child } = await admin.from("trip").select("id").eq("parent_trip_id", tripId).maybeSingle();
    siblingId = child?.id ?? null;
  }
  const otherLeg = siblingId ? await countFor(siblingId) : 0;

  return Math.max(1, rideRiderCount(thisLeg, otherLeg));
}
