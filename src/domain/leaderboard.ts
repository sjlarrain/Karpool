// Leaderboard math — pure, no I/O. The points_ledger is the only source of truth for scores (§4
// Phase 4); this never recomputes a score from raw counts × current weights, it only aggregates
// and presents ledger rows that already carry the weight-derived points at the time each was
// written (D-11: weights are per-group and can change over time without rewriting history).

export type LedgerKind = "drive" | "pool" | "kudos" | "late_leave" | "no_show" | "admin_adjust";

export interface LedgerRow {
  profileId: string;
  kind: LedgerKind;
  points: number;
}

export interface ProfileStats {
  driven: number;
  pooled: number;
  kudos: number;
  points: number;
}

// D-49: `pooled` is no longer a ledger fact. Riders earn nothing for riding, and a zero-point row
// is not storable anyway (`points_ledger` has `check (points <> 0)`), so there is no `pool` row
// left to count. The number a rider sees is now a count of the rides they actually took —
// confirmed `trip_rider` seats on closed trips — passed in by the caller, which keeps D-42's
// promise that a rider can see how often they were pooled without paying them for it.
//
// `pooledRides` is a required argument on purpose. Making it optional would let a caller silently
// fall back to `0 pooled` for everyone, which is precisely the bug D-42 was raised to fix.
export function aggregateLedger(
  rows: LedgerRow[],
  pooledRides: ReadonlyMap<string, number>,
): Map<string, ProfileStats> {
  const stats = new Map<string, ProfileStats>();
  const blank = (): ProfileStats => ({ driven: 0, pooled: 0, kudos: 0, points: 0 });

  for (const row of rows) {
    const current = stats.get(row.profileId) ?? blank();
    current.points += row.points;
    if (row.kind === "drive") current.driven += 1;
    if (row.kind === "kudos") current.kudos += 1;
    stats.set(row.profileId, current);
  }

  // Seeded second, and seeded even when the profile has no ledger rows at all: a member who has
  // only ever ridden earns nothing, so they appear nowhere in the ledger, yet they still have a
  // pooled count to show.
  for (const [profileId, count] of pooledRides) {
    const current = stats.get(profileId) ?? blank();
    current.pooled = count;
    stats.set(profileId, current);
  }

  return stats;
}

export interface TripMonthInput {
  id: string;
  parentTripId: string | null;
  closedAt: string | null; // ISO 8601; null for a trip that never closed
}

// D-50 follow-up (2026-09-01): a round trip's return leg is materialised as its OWN `trip` row
// (D-35), with its own `closed_at`. Windowing each leg on its own timestamp split one continuous
// ride across two months' leaderboards whenever its legs closed on either side of midnight on the
// 1st — the driver's Ranks line showed one fewer trip than the ride they actually drove.
//
// Both legs are attributed to the SAME month, anchored on when the RIDE FINISHED: the latest
// `closed_at` among the ride's legs. Close is when `points_ledger` rows are written, so this is the
// one anchor that cannot disagree with the ledger it is windowing — a ride whose points were all
// earned in September belongs to September, whichever day it set off. A one-way trip is its own
// anchor.
//
// The first version of this anchored on the OUTBOUND'S `depart_at` instead, and that was wrong in
// the way that matters: a round trip that set off on 31 August and got home after midnight had its
// whole award pushed back into August, so on 1 September the driver's Ranks line read zero for a
// ride they had just finished. Reported live within the hour. The lesson is that the window must
// follow the money, not the itinerary.
export function tripsInMonth(trips: TripMonthInput[], monthStart: Date, monthEnd: Date): string[] {
  const byId = new Map(trips.map((t) => [t.id, t]));
  // Every leg of a ride resolves to the same id, so they cannot land in different months.
  const rideRootOf = (trip: TripMonthInput): TripMonthInput =>
    (trip.parentTripId && byId.get(trip.parentTripId)) || trip;

  // The ride's own finish time: the latest close across its legs. Collected per root so a back leg
  // and its parent agree without either needing to know the other's shape.
  const rideFinishedAt = new Map<string, number>();
  for (const trip of trips) {
    if (!trip.closedAt) continue;
    const rootId = rideRootOf(trip).id;
    const closed = new Date(trip.closedAt).getTime();
    rideFinishedAt.set(rootId, Math.max(rideFinishedAt.get(rootId) ?? closed, closed));
  }

  const start = monthStart.getTime();
  const end = monthEnd.getTime();
  const inMonth: string[] = [];
  for (const trip of trips) {
    const anchor = rideFinishedAt.get(rideRootOf(trip).id);
    if (anchor === undefined) continue; // nothing closed on this ride yet — nothing to score
    if (anchor >= start && anchor < end) {
      inMonth.push(trip.id);
    }
  }
  return inMonth;
}

export interface LeaderboardEntry extends ProfileStats {
  profileId: string;
  name: string;
  initials: string;
  color: string;
}

export interface RankedRow extends LeaderboardEntry {
  rank: number;
  medal: string | null;
}

const MEDALS = ["🥇", "🥈", "🥉"];

// Ties keep insertion order for the tied group (a stable sort) rather than re-sorting by name or
// anything else — good enough for a workplace leaderboard, no tiebreaker rule was specified.
export function rankLeaderboard(entries: LeaderboardEntry[]): RankedRow[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.points - a.entry.points || a.index - b.index)
    .map(({ entry }, i) => ({ ...entry, rank: i + 1, medal: i < MEDALS.length ? MEDALS[i]! : null }));
}

// The caption sits in a 10.5px slot next to "Leaderboard", so it states the shape of the scoring
// rather than the full formula. Three terms since D-49 dropped the rider's award, in the order the
// points are earned: driving, filling the car (both paid to the driver), and kudos (scaled by how
// full the car was, D-19). Riding pays nothing and so has nothing to state here.
export function formatWeightsCaption(weights: {
  driveWeight: number;
  poolWeight: number;
  poolStep: number;
  kudosWeight: number;
}): string {
  const seat = weights.poolStep === 0 ? `${weights.poolWeight}/seat` : `${weights.poolWeight}+${weights.poolStep}/seat`;
  return `${weights.driveWeight}·drive · ${seat} · ${weights.kudosWeight}·kudos×riders`;
}
