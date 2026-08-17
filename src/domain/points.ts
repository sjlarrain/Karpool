// Points ledger math — pure, no I/O. Entries are always append-only descriptors here; the caller
// inserts them into points_ledger verbatim (CLAUDE.md §3.5: money-like data is a ledger, never a
// mutable counter).

export interface LedgerAward {
  kind: "drive" | "pool" | "late_leave";
  points: number;
  reason: string;
}

// Closing a trip awards the DRIVER, not the riders: 1 "drive" entry, plus 1 "pool" entry per
// confirmed rider (registered or guest — guests have no profile to hold their own points, so their
// contribution can only ever land on the driver; "Guest riders still count toward your pooled
// score" per the sketch's close-overlay copy applies uniformly to every confirmed rider).
export function computeCloseAwards(
  riderNames: string[],
  weights: { driveWeight: number; poolWeight: number },
): LedgerAward[] {
  return [
    { kind: "drive", points: weights.driveWeight, reason: "Drove the trip" },
    ...riderNames.map((name) => ({ kind: "pool" as const, points: weights.poolWeight, reason: `Pooled ${name}` })),
  ];
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
