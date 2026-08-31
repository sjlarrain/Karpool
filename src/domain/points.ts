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
}

// Kept for the callers that still need to tell a registered rider from a guest when building the
// confirmed-rider list. Both count identically toward the driver's fill bonus; since D-49 neither
// earns anything, so the distinction no longer changes any award.
export interface CloseRider {
  profileId: string | null;
  name: string;
}

export interface CloseAwards {
  // The only row a close writes. Carries the flat drive weight plus the whole fill bonus.
  // D-49: riders get no award of any kind — see computeCloseAwards.
  driver: LedgerAward;
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
 * Closing a trip pays exactly one person: the DRIVER (D-49).
 *
 * They get one `drive` row worth the flat drive weight plus the fill bonus for every seat they
 * filled, guests included. Riders earn nothing — the developer's call on 2026-08-31: driving is
 * the behaviour the app pays for, and riding is not.
 *
 * That is NOT a reversal of D-42. D-42 asked that a rider be able to see how often they were
 * pooled, and they still can: `pooled` is now a count of confirmed rides (see
 * `leaderboard.ts#aggregateLedger`), sourced from `trip_rider` rather than from the ledger. The
 * count survives; only its point value is gone.
 *
 * Deriving the count that way is also the only shape that works. `points_ledger` carries
 * `check (points <> 0)`, so "keep the row, make it worth zero" is not expressible — a zero-point
 * `pool` row is rejected by the database and would fail the whole close, the same trap D-43 found
 * behind `kudos_weight = 0`.
 */
export function computeCloseAwards(riderCount: number, weights: CloseWeights): CloseAwards {
  const bonus = seatBonus(riderCount, weights.poolWeight, weights.poolStep);
  return {
    driver: {
      kind: "drive",
      points: weights.driveWeight + bonus,
      reason: riderCount === 0 ? "Drove the trip" : `Drove the trip (${riderCount} pooled)`,
    },
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
