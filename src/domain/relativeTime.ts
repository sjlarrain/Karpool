// Relative timestamps for the notification bell. The sketch's mock notification list shows the
// exact vocabulary this has to produce: "now", "2m", "1h", "3h", "1d" — a compact right-aligned
// stamp, not a sentence ("2 minutes ago"). Pure, so the bell and any future feed share one
// implementation and the boundaries are unit-testable (CLAUDE.md §3.5).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// Anything older than this stops being usefully relative and becomes a date.
const RELATIVE_LIMIT = 4 * WEEK;

const ABSOLUTE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Compact relative stamp for `iso`, measured against `now`.
 * Future timestamps clamp to "now" — a clock skew between the server row and the client should
 * never render as a negative age.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const elapsed = now.getTime() - then;
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  if (elapsed < RELATIVE_LIMIT) return `${Math.floor(elapsed / WEEK)}w`;
  return ABSOLUTE.format(new Date(then));
}
