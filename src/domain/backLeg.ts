// D-35 — the round trip's return leg. Pure decisions only, no I/O: the API route and (later) the
// cron tick both close trips, and both have to answer the same three questions the same way.
//
// The shape: a round trip is ONE row until its outbound closes, at which point the return becomes
// a real trip of its own carrying the riders who declared at join time that they were coming back.
// Materialising it lazily is what keeps every other rule in the app working unchanged — each row
// then has exactly one departure, so start windows, expiry and the points engine all measure
// against a `depart_at` that is actually true.

export interface BackLegSource {
  direction: "out" | "back" | "round";
  returnAt: string | null;
  // Set once the return leg exists. Guards nothing on its own — the unique index on
  // trip.parent_trip_id is the real backstop — but lets a caller skip a pointless round trip.
  hasBackLeg?: boolean;
}

/**
 * Whether closing this trip should materialise a return leg. Only a round trip with a return time
 * has one; a one-way `out` or `back` is already the whole ride.
 */
export function shouldGenerateBackLeg(trip: BackLegSource): boolean {
  return trip.direction === "round" && !!trip.returnAt && !trip.hasBackLeg;
}

export interface KudosPromptInput {
  // Registered riders confirmed on the leg being closed right now.
  confirmedProfileIds: string[];
  // Of those, the ones who were just seated on the return leg. Empty when no leg was generated.
  seatedOnBackLegProfileIds: string[];
}

/**
 * D-35 answer (B): kudos is one per rider per RIDE, not per leg, and it fires when the ride is
 * actually over.
 *
 * Closing the outbound therefore prompts only the riders who are NOT coming back — for them the
 * ride ended here. Anyone seated on the return leg is left alone and prompted when that leg
 * closes, so a rider who travels both ways is asked exactly once, at the end, rather than twice on
 * the same driver on the same day.
 */
export function kudosPromptTargets({ confirmedProfileIds, seatedOnBackLegProfileIds }: KudosPromptInput): string[] {
  const returning = new Set(seatedOnBackLegProfileIds);
  return confirmedProfileIds.filter((id) => !returning.has(id));
}

/**
 * D-35 mechanic (ii): has the scheduler waited long enough for the driver to close the outbound?
 *
 * The generation deadline is measured against the RETURN departure, not the outbound one. That is
 * what makes it useful: a rider needs to know whether they have a seat home while there is still
 * time to arrange one if they do not, and the outbound's own timing says nothing about that. A
 * driver who closes normally always beats this — the deadline only fires for a ride nobody closed.
 */
export function isReturnLegDue(returnAt: string, now: Date, leadMinutes: number): boolean {
  const deadline = new Date(returnAt).getTime() - leadMinutes * 60_000;
  return now.getTime() >= deadline;
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
