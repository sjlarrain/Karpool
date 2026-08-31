// Points ledger math — pure, no I/O. Entries are always append-only descriptors here; the caller
// inserts them into points_ledger verbatim (CLAUDE.md §3.5: money-like data is a ledger, never a
// mutable counter).
//
// Scoring changed on 2026-08-19 (D-19). Two of the three rules are no longer flat:
//   - filling the car escalates per seat, so a full car is worth disproportionately more than a
//     solo pickup (D-42 moved this into the driver's `drive` row; it used to be `pool` rows)
//   - a kudos is scaled by how full that car was, so rating rewards pooling rather than just driving
//   - a no-show now costs the rider who booked the seat and didn't ride
// Historic ledger rows are never rewritten: entries carry the points they were worth when written.

export interface LedgerAward {
  kind: "drive" | "pool" | "kudos" | "late_leave" | "no_show";
  points: number;
  reason: string;
}

export interface CloseWeights {
  driveWeight: number;
  // Prices the driver's fill bonus: the nth seat adds poolWeight + (n-1)·poolStep to their drive
  // award. D-42 — this is NOT what a rider earns.
  poolWeight: number;
  poolStep: number;
  // What one ride as a passenger is worth to the rider. Flat: a seat's escalating value is the
  // driver's incentive to fill the car, and a rider does not choose how full it is.
  riderPoolWeight: number;
}

export interface CloseRider {
  // Null for a guest. A guest fills a seat, so they still pay the driver's fill bonus, but they
  // have no profile to hold points and so earn nothing themselves (D-09).
  profileId: string | null;
  name: string;
}

export interface CloseAwards {
  // One row, always. Carries the flat drive weight plus the whole fill bonus.
  driver: LedgerAward;
  // One row per registered confirmed rider, on the RIDER's own ledger.
  riders: { profileId: string; award: LedgerAward }[];
}

/**
 * What the nth confirmed rider on a trip adds to the DRIVER's award (`seatIndex` is 0-based).
 * With the defaults (3, step 2) the seats pay 3, 5, 7 — filling the car beats driving it empty,
 * which is the behaviour the whole app exists to encourage.
 */
export function poolPointsForSeat(seatIndex: number, poolWeight: number, poolStep: number): number {
  return poolWeight + seatIndex * poolStep;
}

/** The driver's whole fill bonus for carrying `seatCount` riders — every seat, summed. */
export function seatBonus(seatCount: number, poolWeight: number, poolStep: number): number {
  let total = 0;
  for (let seat = 0; seat < seatCount; seat += 1) {
    total += poolPointsForSeat(seat, poolWeight, poolStep);
  }
  return total;
}

/**
 * Closing a trip pays two different people for two different things (D-42):
 *   - the DRIVER gets one `drive` row: the flat drive weight plus the fill bonus for every seat
 *     they filled, guests included.
 *   - each registered confirmed RIDER gets one `pool` row of their own, because being pooled is
 *     the thing a rider did. Guests are skipped — no profile, nowhere to put it.
 *
 * The driver deliberately gets no `pool` row: they drove, they were not pooled. That inversion is
 * exactly what D-42 exists to correct.
 */
export function computeCloseAwards(riders: CloseRider[], weights: CloseWeights, driverName?: string): CloseAwards {
  const bonus = seatBonus(riders.length, weights.poolWeight, weights.poolStep);
  return {
    driver: {
      kind: "drive",
      points: weights.driveWeight + bonus,
      reason: riders.length === 0 ? "Drove the trip" : `Drove the trip (${riders.length} pooled)`,
    },
    riders: riders
      .filter((rider): rider is CloseRider & { profileId: string } => !!rider.profileId)
      .map((rider) => ({
        profileId: rider.profileId,
        award: {
          kind: "pool" as const,
          points: weights.riderPoolWeight,
          reason: driverName ? `Pooled with ${driverName}` : "Pooled on a trip",
        },
      })),
  };
}

/**
 * What a single kudos is worth to the driver, scaled by how many riders were confirmed on that
 * trip: kudos on a full car pay more than kudos on a solo pickup. Never scales below one rider —
 * the person giving the kudos is themselves a confirmed rider, so the floor is the base weight.
 */
export function computeKudosAward(kudosWeight: number, confirmedRiderCount: number): LedgerAward {
  const riders = Math.max(1, confirmedRiderCount);
  return {
    kind: "kudos",
    points: kudosWeight * riders,
    reason: riders > 1 ? `Received kudos (${riders} riders pooled)` : "Received kudos",
  };
}

/**
 * Charged to the RIDER — not the driver — for each registered rider who booked a seat and was not
 * confirmed at close. Guests are never penalised: they have no profile to hold points, and nobody
 * booked on their behalf. `penalty` is expected to be negative, matching the stored column.
 */
export function computeNoShowPenalty(penalty: number): LedgerAward {
  return { kind: "no_show", points: penalty, reason: "Booked a seat and didn't ride" };
}

// A leave counts as late once it falls inside the group's configured cancellation window — from
// windowMinutes before departure through any time after (a no-show after departure is at least as
// late as one right at T-minus-window).
export function isLateLeave(departAt: Date, now: Date, windowMinutes: number): boolean {
  return departAt.getTime() - now.getTime() <= windowMinutes * 60_000;
}

export function computeLateLeavePenalty(
  departAt: Date,
  now: Date,
  windowMinutes: number,
  penalty: number,
): LedgerAward | null {
  if (!isLateLeave(departAt, now, windowMinutes)) return null;
  return { kind: "late_leave", points: penalty, reason: "Left within the cancellation window" };
}
