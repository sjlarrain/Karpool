// D-47: nothing stopped a trip departing in the past, or returning before it departs. Pure so
// create and edit share one definition of an impossible schedule.

export function isDepartureInPast(departAt: string, now: Date): boolean {
  const depart = Date.parse(departAt);
  return !Number.isNaN(depart) && depart < now.getTime();
}

export function isReturnBeforeDeparture(departAt: string, returnAt: string): boolean {
  const depart = Date.parse(departAt);
  const ret = Date.parse(returnAt);
  return !Number.isNaN(depart) && !Number.isNaN(ret) && ret <= depart;
}
