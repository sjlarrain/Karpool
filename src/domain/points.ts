// Points ledger math — pure, no I/O. Entries are always append-only descriptors here; the caller
// inserts them into points_ledger verbatim (CLAUDE.md §3.5: money-like data is a ledger, never a
// mutable counter).
//
// Scoring changed on 2026-08-19 (D-19). Two of the three rules are no longer flat:
//   - pooling escalates per seat, so a full car is worth disproportionately more than a solo pickup
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
  poolWeight: number;
  // Added to each successive seat: the nth rider is worth poolWeight + (n-1)·poolStep.
  poolStep: number;
}

/**
 * What the nth confirmed rider on a trip is worth to the driver (`seatIndex` is 0-based).
 * With the defaults (3, step 2) the seats pay 3, 5, 7 — filling the car beats three solo trips,
 * which is the behaviour the whole app exists to encourage.
 */
export function poolPointsForSeat(seatIndex: number, poolWeight: number, poolStep: number): number {
  return poolWeight + seatIndex * poolStep;
}

// Closing a trip awards the DRIVER, not the riders: 1 "drive" entry, plus 1 "pool" entry per
// confirmed rider (registered or guest — guests have no profile to hold their own points, so their
// contribution can only ever land on the driver; "Guest riders still count toward your pooled
// score" per the sketch's close-overlay copy applies uniformly to every confirmed rider).
export function computeCloseAwards(riderNames: string[], weights: CloseWeights): LedgerAward[] {
  return [
    { kind: "drive", points: weights.driveWeight, reason: "Drove the trip" },
    ...riderNames.map((name, index) => ({
      kind: "pool" as const,
      points: poolPointsForSeat(index, weights.poolWeight, weights.poolStep),
      reason: `Pooled ${name}`,
    })),
  ];
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
