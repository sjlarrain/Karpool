// Pure date-display helpers, no I/O — "now" is always passed in. Format matches the sketch's mock
// data verbatim: "Today · Mon 18", "Tomorrow · Tue 19", "Wed 20" (docs/Carpool App.dc.html).

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function dayLabel(date: Date, now: Date): string {
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const dayOfMonth = date.getDate();
  if (diffDays === 0) return `Today · ${weekday} ${dayOfMonth}`;
  if (diffDays === 1) return `Tomorrow · ${weekday} ${dayOfMonth}`;
  return `${weekday} ${dayOfMonth}`;
}

export function formatTripTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
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
