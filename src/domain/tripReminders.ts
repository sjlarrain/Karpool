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
 * Has this started trip been open long enough that its driver should be nudged to close it?
 *
 * `startedAt` null means the row says `started` but never recorded when — treat it as not due
 * rather than as infinitely overdue, so a data fault can't spray notifications.
 */
export function isCloseReminderDue(startedAt: string | null, now: Date, afterMinutes: number): boolean {
  if (!startedAt) return false;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return false;
  return now.getTime() - started >= afterMinutes * 60_000;
}
