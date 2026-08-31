// D-38. What changed when a driver edits a trip, and whether that change is one a rider who
// already holds a seat needs to know about. Pure — no I/O — so the API route and its tests share
// one definition of "material".
//
// "Material" is judged from the rider's chair, not the driver's: the time it leaves and where it
// detours are the ride they agreed to. Capacity is not — a driver freeing or taking back an unsold
// seat changes nothing for the people already in the car.

export type TripEditField = "departAt" | "returnAt" | "capacity" | "outStopId" | "backStopId";

export const MATERIAL_TRIP_EDIT_FIELDS: readonly TripEditField[] = ["departAt", "returnAt", "outStopId", "backStopId"];

export interface TripEditState {
  departAt: string; // ISO 8601
  returnAt: string | null;
  capacity: number;
  outStopId: string | null;
  backStopId: string | null;
}

export type TripEditPatch = Partial<TripEditState>;

export interface TripEditNotice {
  title: string;
  body: string;
}

export interface TripEditDiff {
  changed: TripEditField[];
  // True when at least one changed field is one the riders were relying on.
  material: boolean;
  // What the riders are told. Null when nothing material changed — a seat-count tweak is the
  // driver's business and pushing it to five phones would train people to ignore the channel.
  notice: TripEditNotice | null;
}

// Two ISO strings can spell the same instant ("…T07:45:00Z" from the client, "…T07:45:00+00:00"
// back from Postgres), so instants are compared as instants. An unparseable value is treated as
// changed rather than equal — zod has already rejected it upstream, and failing towards "tell the
// riders" is the safe direction.
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  return left === right;
}

export function diffTripEdit(current: TripEditState, patch: TripEditPatch): TripEditDiff {
  const changed: TripEditField[] = [];

  if (patch.departAt !== undefined && !sameInstant(current.departAt, patch.departAt)) changed.push("departAt");
  if (patch.returnAt !== undefined && !sameInstant(current.returnAt, patch.returnAt)) changed.push("returnAt");
  if (patch.capacity !== undefined && patch.capacity !== current.capacity) changed.push("capacity");
  if (patch.outStopId !== undefined && patch.outStopId !== current.outStopId) changed.push("outStopId");
  if (patch.backStopId !== undefined && patch.backStopId !== current.backStopId) changed.push("backStopId");

  const material = changed.some((field) => MATERIAL_TRIP_EDIT_FIELDS.includes(field));
  const timeChanged = changed.includes("departAt") || changed.includes("returnAt");
  const stopsChanged = changed.includes("outStopId") || changed.includes("backStopId");

  return {
    changed,
    material,
    notice: material ? { title: noticeTitle(timeChanged, stopsChanged), body: noticeBody(timeChanged, stopsChanged) } : null,
  };
}

function noticeTitle(timeChanged: boolean, stopsChanged: boolean): string {
  if (timeChanged && stopsChanged) return "Trip updated";
  return timeChanged ? "Departure changed" : "Route changed";
}

// Every wording ends the same way, because the free drop-out is the part a rider has to act on:
// the ride they booked is not the ride they now have, so leaving it costs them nothing (D-38).
function noticeBody(timeChanged: boolean, stopsChanged: boolean): string {
  const what =
    timeChanged && stopsChanged
      ? "Your driver changed this trip's time and where it stops."
      : timeChanged
        ? "Your driver changed this trip's departure time."
        : "Your driver changed where this trip stops.";
  return `${what} If it no longer works for you, you can leave with no points lost.`;
}
