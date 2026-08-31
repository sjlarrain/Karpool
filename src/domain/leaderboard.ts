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
