import { correctionWindowEnd } from "./tripSettle";

// D-63 (developer, 2026-09-28) — pure rules for postponing a ride that settled at its departure but
// did not actually leave. No I/O; "now" and the zone are passed in.
//
//   - only a SETTLED ride (a ride still ahead is simply edited), and only on the day it left — the
//     same end-of-day window the driver has for fixing the ride list, in the driver's own zone;
//   - only to a LATER time that same day ("Later the same day only"). A ride that can't happen
//     today is cancelled, not carried into tomorrow;
//   - a round trip's return stays where it is ("the return stays the same"), so the outbound must
//     still leave before it.

export type PostponeError = "not_settled" | "window_closed" | "not_later" | "other_day" | "after_return";

export type PostponeCheck = { ok: true } | { ok: false; error: PostponeError };

export function checkPostpone(
  trip: { status: string; departAt: string | Date; returnAt: string | Date | null },
  newDepartAt: string | Date,
  now: Date,
  timeZone: string,
): PostponeCheck {
  if (trip.status !== "closed") return { ok: false, error: "not_settled" };

  const dayEnd = correctionWindowEnd(trip.departAt, timeZone).getTime();
  if (now.getTime() >= dayEnd) return { ok: false, error: "window_closed" };

  const next = new Date(newDepartAt).getTime();
  if (Number.isNaN(next) || next <= now.getTime()) return { ok: false, error: "not_later" };
  if (next >= dayEnd) return { ok: false, error: "other_day" };

  if (trip.returnAt !== null && next >= new Date(trip.returnAt).getTime()) {
    return { ok: false, error: "after_return" };
  }
  return { ok: true };
}

/** What the driver is told when a postpone is refused — the act, in their words. */
export const POSTPONE_ERROR_MESSAGES: Record<PostponeError, string> = {
  not_settled: "Only a ride that has already left can be postponed. Edit it instead.",
  window_closed: "A ride can only be postponed on the day it was for.",
  not_later: "Pick a time later than now.",
  other_day: "Pick a time later today. If it can't happen today, cancel it instead.",
  after_return: "The ride has to leave before its return time.",
};
