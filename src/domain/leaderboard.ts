// Leaderboard math — pure, no I/O. The points_ledger is the only source of truth for scores (§4
// Phase 4); this never recomputes a score from raw counts × current weights, it only aggregates
// and presents ledger rows that already carry the weight-derived points at the time each was
// written (D-11: weights are per-group and can change over time without rewriting history).

export type LedgerKind = "drive" | "pool" | "kudos" | "late_leave" | "admin_adjust";

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

export function aggregateLedger(rows: LedgerRow[]): Map<string, ProfileStats> {
  const stats = new Map<string, ProfileStats>();
  for (const row of rows) {
    const current = stats.get(row.profileId) ?? { driven: 0, pooled: 0, kudos: 0, points: 0 };
    current.points += row.points;
    if (row.kind === "drive") current.driven += 1;
    if (row.kind === "pool") current.pooled += 1;
    if (row.kind === "kudos") current.kudos += 1;
    stats.set(row.profileId, current);
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

export function formatWeightsCaption(weights: { driveWeight: number; poolWeight: number; kudosWeight: number }): string {
  return `${weights.driveWeight}·drive + ${weights.poolWeight}·pool + ${weights.kudosWeight}·kudos`;
}
