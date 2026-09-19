// D-35 — the round trip's return leg. Pure decisions only, no I/O.
//
// The shape: a round trip is ONE row until its outbound settles, at which point the return becomes
// a real trip of its own carrying the riders who declared at join time that they were coming back.
// Materialising it lazily is what keeps every other rule in the app working unchanged — each row
// then has exactly one departure, so the settle, the reminders and the points engine all measure
// against a `depart_at` that is actually true. Since D-61 the outbound settles AT its departure,
// so the leg always exists well before `return_at` — which retired D-35 mechanic (ii)'s T-2h
// scheduler close, and the D-60 failure it kept running into.

export interface BackLegSource {
  direction: "out" | "back" | "round";
  returnAt: string | null;
  // Set once the return leg exists. Guards nothing on its own — the unique index on
  // trip.parent_trip_id is the real backstop — but lets a caller skip a pointless round trip.
  hasBackLeg?: boolean;
}

/**
 * Whether settling this trip should materialise a return leg. Only a round trip with a return time
 * has one; a one-way `out` or `back` is already the whole ride.
 */
export function shouldGenerateBackLeg(trip: BackLegSource): boolean {
  return trip.direction === "round" && !!trip.returnAt && !trip.hasBackLeg;
}

/**
 * D-35 answer (B), the multiplier half: `computeKudosAward` scales a kudos by how full the car was,
 * so a two-leg ride needs one number rather than two. It is the FULLER leg — a driver who carried
 * three people out and two back drove a three-person car, and should not be paid less because
 * someone walked home.
 */
export function rideRiderCount(outboundConfirmed: number, backConfirmed: number): number {
  return Math.max(outboundConfirmed, backConfirmed);
}
