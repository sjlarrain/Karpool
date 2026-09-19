import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { transition, type TripTransitionErrorCode } from "@/domain/tripMachine";
import { settleDriveAward } from "@/lib/api/driveAward";
import { shouldGenerateBackLeg, rideRiderCount } from "@/domain/backLeg";

// D-61 (developer, 2026-09-19) — a trip counts the moment its departure time passes. Nobody taps
// Start and nobody taps Close: the scheduler calls this once per departed trip, and it does in one
// step everything those two taps used to do between them.
//
//   1. claim the trip (scheduled → closed) — the only step that can lose a race
//   2. count every booked seat as ridden (joined → confirmed)
//   3. materialise a round trip's return leg, which then settles at its own departure
//   4. pay the driver: drive_weight + the seat bonus (D-49), via the same ledger helper D-56 wrote
//
// Nobody is notified. The departure reminder already went out 15 minutes earlier, and kudos now
// lives on the card rather than in a push (developer: "Shown on the card after it departs").
//
// Whatever turns out to be wrong about the roster is the driver's to fix until the end of the day:
// a no-show report (POST /api/trips/:id/no-show) or a late seat (POST /riders, POST /guests).

export interface SettleTripSuccess {
  ok: true;
  seatsFilled: number;
  pointsAwarded: number;
  backTripId: string | null;
}

export interface SettleTripFailure {
  ok: false;
  error: TripTransitionErrorCode | "not_found" | "update_failed" | "confirm_failed" | "back_leg_failed" | "ledger_write_failed";
  message?: string;
}

export type SettleTripResult = SettleTripSuccess | SettleTripFailure;

export async function settleTrip(tripId: string, now: Date = new Date()): Promise<SettleTripResult> {
  const admin = createSupabaseAdminClient();

  const { data: trip, error: tripError } = await admin
    .from("trip")
    .select("id, driver_id, status, depart_at, group_id, direction, return_at")
    .eq("id", tripId)
    .maybeSingle();
  if (tripError) return { ok: false, error: "update_failed", message: tripError.message };
  if (!trip) return { ok: false, error: "not_found" };

  const result = transition(
    { status: trip.status, driverId: trip.driver_id, departAt: trip.depart_at },
    "settle",
    { isSystem: true },
    now,
  );
  if (!result.ok) return { ok: false, error: result.error };

  // THE CLAIM, first and alone. A compare-and-swap on `scheduled`: two ticks racing for one trip
  // (a slow tick overlapping the next) serialise on the row, and the loser matches nothing and
  // writes nothing. closeTrip used to rewrite seats BEFORE its claim, so a losing caller had already
  // touched the roster; here nothing happens until the claim is won.
  const { data: claimed, error: claimError } = await admin
    .from("trip")
    .update({ status: result.nextStatus, closed_at: now.toISOString() })
    .eq("id", tripId)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (claimError) return { ok: false, error: "update_failed", message: claimError.message };
  if (!claimed) return { ok: false, error: "wrong_status" };

  // Every failure after the claim hands it back, so the next tick retries the whole settle. All the
  // steps below are idempotent (confirming seats, generate_back_trip(), and settleDriveAward, which
  // appends only what is still owed), so a retry can never double anything. Guarded on `closed` so
  // it only ever undoes this call's own claim.
  async function releaseClaim(failure: SettleTripFailure): Promise<SettleTripFailure> {
    const { error: revertError } = await admin
      .from("trip")
      .update({ status: "scheduled", closed_at: null })
      .eq("id", tripId)
      .eq("status", "closed");
    if (!revertError) return failure;
    return {
      ...failure,
      message: `${failure.message ?? failure.error} (and the trip could not be reopened: ${revertError.message})`,
    };
  }

  // Every booked seat counts as ridden (D-61). Guests seated before departure included.
  const { error: confirmError } = await admin
    .from("trip_rider")
    .update({ state: "confirmed" })
    .eq("trip_id", tripId)
    .eq("state", "joined");
  if (confirmError) return releaseClaim({ ok: false, error: "confirm_failed", message: confirmError.message });

  // After confirming, because generate_back_trip() seats only CONFIRMED outbound riders who said
  // they were coming back. Settling at departure means the leg is created long before `return_at`,
  // so D-60 cannot happen on this path; 0026 dates the leg from its parent regardless.
  let backTripId: string | null = null;
  if (shouldGenerateBackLeg({ direction: trip.direction, returnAt: trip.return_at })) {
    const { data: backTrip, error: backError } = await admin.rpc("generate_back_trip", { p_parent_trip_id: tripId });
    if (backError) return releaseClaim({ ok: false, error: "back_leg_failed", message: backError.message });
    const generated = Array.isArray(backTrip) ? backTrip[0] : backTrip;
    backTripId = generated?.id ?? null;
  }

  const award = await settleDriveAward(admin, { id: tripId, driver_id: trip.driver_id, group_id: trip.group_id });
  if (award.error) return releaseClaim({ ok: false, error: "ledger_write_failed", message: award.error });

  const { count } = await admin
    .from("trip_rider")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", tripId)
    .eq("state", "confirmed");

  return { ok: true, seatsFilled: count ?? 0, pointsAwarded: award.total, backTripId };
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
