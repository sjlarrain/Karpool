import { zonedParts } from "./tripDay";

// D-61 — pure timing for the automatic lifecycle. No I/O; "now" and the zone are always passed in.
//
// A trip settles once its departure has passed. After that the driver has until the END OF THAT
// DAY to put the ride list right: report a rider who didn't show, or add someone who rode without
// booking (developer, 2026-09-19: "Until end of that day"). "That day" is a civil day, so it needs
// a zone — the driver's, taken from the request, because the driver is the one fixing the list.

export function isSettleDue(departAt: string | Date, now: Date): boolean {
  const depart = new Date(departAt).getTime();
  if (Number.isNaN(depart)) return false;
  return depart <= now.getTime();
}

// Offset of `timeZone` from UTC at `instant`, in ms (positive east of Greenwich).
function zoneOffsetMs(instant: number, timeZone: string): number {
  const p = zonedParts(new Date(instant), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  // zonedParts has minute resolution, so drop the instant's seconds before comparing.
  return asUtc - (instant - (instant % 60_000));
}

/**
 * The first instant AFTER the departure's civil day, in `timeZone` — the correction window is
 * open while `now` is before it. Midnight is located by resolving the zone's offset at the
 * candidate itself (twice, so a DST change on that night lands on the right side).
 */
export function correctionWindowEnd(departAt: string | Date, timeZone: string): Date {
  const p = zonedParts(new Date(departAt), timeZone);
  const nextMidnightWall = Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0);
  let instant = nextMidnightWall - zoneOffsetMs(nextMidnightWall, timeZone);
  instant = nextMidnightWall - zoneOffsetMs(instant, timeZone);
  return new Date(instant);
}

/** Can the driver still fix this trip's ride list? Only a settled (closed) trip inside its day. */
export function canCorrect(
  trip: { status: string; departAt: string | Date },
  now: Date,
  timeZone: string,
): boolean {
  if (trip.status !== "closed") return false;
  return now.getTime() < correctionWindowEnd(trip.departAt, timeZone).getTime();
}
