// Pure timing decisions for the scheduler's two reminder jobs (CLAUDE.md §3.5 — domain logic has no
// I/O and is unit-tested). src/app/api/cron/tick/route.ts supplies the rows; these functions decide
// which of them are owed a notification.

/**
 * Is this trip inside the departure-reminder window?
 *
 * The window is two-sided on purpose. The upper bound is the lead time — don't warn someone about a
 * trip that is still an hour away. The lower bound is a grace period *behind* `now`, and it is the
 * bug fix: the original query ran from `now` forward, so a trip whose departure slipped past
 * between two ticks became permanently ineligible and its riders were never told anything. A
 * scheduler that misses one tick should send a slightly late reminder, not no reminder.
 */
export function isDepartureReminderDue(
  departAt: string | Date,
  now: Date,
  leadMinutes: number,
  graceMinutes: number,
): boolean {
  const depart = new Date(departAt).getTime();
  if (Number.isNaN(depart)) return false;
  const nowMs = now.getTime();
  return depart <= nowMs + leadMinutes * 60_000 && depart >= nowMs - graceMinutes * 60_000;
}

/**
 * D-61: is this departed trip owed its "pay for parking" nudge?
 *
 * Due from `afterMinutes` past departure, for `graceMinutes` after that. Bounded on purpose: a
 * scheduler that was down for a day must not wake up and nag about yesterday's parking.
 */
export function isParkingReminderDue(
  departAt: string | Date,
  now: Date,
  afterMinutes: number,
  graceMinutes: number,
): boolean {
  const depart = new Date(departAt).getTime();
  if (Number.isNaN(depart)) return false;
  const dueAt = depart + afterMinutes * 60_000;
  const nowMs = now.getTime();
  return nowMs >= dueAt && nowMs <= dueAt + graceMinutes * 60_000;
}
