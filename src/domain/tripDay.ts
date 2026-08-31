// Pure date-display helpers, no I/O — "now" and the viewer's time zone are always passed in.
// Format matches the sketch's mock data verbatim: "Today · Mon 18", "Tomorrow · Tue 19", "Wed 20"
// (docs/Carpool App.dc.html).
//
// Every function here is zone-explicit on purpose. These used to read the runtime's local clock
// (getHours/getDate), which is the browser's zone in a test and UTC on Vercel — so the same trip
// rendered as two different times depending on where it was rendered. There is no "local" here any
// more: the caller says which zone the reader is in (see src/domain/timeZone.ts).

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  weekday: string; // "Mon"
}

// Intl.DateTimeFormat construction is the expensive part, and both helpers run once per trip per
// render, so formatters are memoised per zone. Bounded by the number of zones a process sees.
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    // h23, not hour12:false — the latter can render midnight as "24" on some ICU builds.
    hourCycle: "h23",
  });
  FORMATTERS.set(timeZone, formatter);
  return formatter;
}

// The civil (wall-clock) date and time of an absolute instant, as read in `timeZone`.
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    weekday: value("weekday"),
  };
}

export function dayLabel(date: Date, now: Date, timeZone: string): string {
  const then = zonedParts(date, timeZone);
  const today = zonedParts(now, timeZone);
  // Both dates are turned into UTC midnights purely to subtract calendar days: the civil dates are
  // already zone-correct, and UTC arithmetic has no DST-length days to trip over.
  const diffDays = Math.round(
    (Date.UTC(then.year, then.month - 1, then.day) - Date.UTC(today.year, today.month - 1, today.day)) / 86_400_000,
  );
  if (diffDays === 0) return `Today · ${then.weekday} ${then.day}`;
  if (diffDays === 1) return `Tomorrow · ${then.weekday} ${then.day}`;
  return `${then.weekday} ${then.day}`;
}

export function formatTripTime(date: Date, timeZone: string): string {
  const { hour, minute } = zonedParts(date, timeZone);
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

// Groups already-decorated items by their computed day label, preserving each day's first
// appearance order and sorting within a day by a caller-supplied comparator.
export function groupByDay<T>(
  items: T[],
  labelFor: (item: T) => string,
  sortWithinDay: (a: T, b: T) => number,
): { label: string; items: T[] }[] {
  const order: string[] = [];
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const label = labelFor(item);
    if (!buckets.has(label)) {
      buckets.set(label, []);
      order.push(label);
    }
    buckets.get(label)!.push(item);
  }
  return order.map((label) => ({ label, items: buckets.get(label)!.slice().sort(sortWithinDay) }));
}
