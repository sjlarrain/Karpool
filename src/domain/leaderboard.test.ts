import { describe, expect, it } from "vitest";
import { aggregateLedger, rankLeaderboard, formatWeightsCaption } from "./leaderboard";
import type { LedgerRow, LeaderboardEntry } from "./leaderboard";

describe("aggregateLedger", () => {
  it("sums points and counts drive/pool/kudos entries per profile", () => {
    const rows: LedgerRow[] = [
      { profileId: "a", kind: "drive", points: 10 },
      { profileId: "a", kind: "pool", points: 3 },
      { profileId: "a", kind: "pool", points: 3 },
      { profileId: "a", kind: "kudos", points: 2 },
      { profileId: "b", kind: "drive", points: 10 },
    ];
    const stats = aggregateLedger(rows);
    expect(stats.get("a")).toEqual({ driven: 1, pooled: 2, kudos: 1, points: 18 });
    expect(stats.get("b")).toEqual({ driven: 1, pooled: 0, kudos: 0, points: 10 });
  });

  it("counts late_leave and admin_adjust toward points but not any tile", () => {
    const rows: LedgerRow[] = [
      { profileId: "a", kind: "drive", points: 10 },
      { profileId: "a", kind: "late_leave", points: -5 },
    ];
    expect(aggregateLedger(rows).get("a")).toEqual({ driven: 1, pooled: 0, kudos: 0, points: 5 });
  });

  it("returns an empty map for no rows", () => {
    expect(aggregateLedger([]).size).toBe(0);
  });
});

const entry = (profileId: string, points: number): LeaderboardEntry => ({
  profileId,
  name: profileId,
  initials: "XX",
  color: "#000",
  driven: 0,
  pooled: 0,
  kudos: 0,
  points,
});

describe("rankLeaderboard", () => {
  it("sorts descending by points and assigns medals to the top 3", () => {
    const ranked = rankLeaderboard([entry("d", 5), entry("a", 20), entry("b", 15), entry("c", 10)]);
    expect(ranked.map((r) => r.profileId)).toEqual(["a", "b", "c", "d"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(ranked.map((r) => r.medal)).toEqual(["🥇", "🥈", "🥉", null]);
  });

  it("breaks ties by original order (stable)", () => {
    const ranked = rankLeaderboard([entry("a", 10), entry("b", 10)]);
    expect(ranked.map((r) => r.profileId)).toEqual(["a", "b"]);
  });

  it("handles an empty leaderboard", () => {
    expect(rankLeaderboard([])).toEqual([]);
  });
});

describe("formatWeightsCaption", () => {
  it("states the shape of the scoring, not just the weights (D-19)", () => {
    expect(formatWeightsCaption({ driveWeight: 10, poolWeight: 3, poolStep: 2, kudosWeight: 2 })).toBe(
      "10·drive · pool 3+2/seat · 2·kudos×riders",
    );
  });

  it("reflects non-default weights", () => {
    expect(formatWeightsCaption({ driveWeight: 20, poolWeight: 5, poolStep: 4, kudosWeight: 1 })).toBe(
      "20·drive · pool 5+4/seat · 1·kudos×riders",
    );
  });

  it("drops the per-seat wording when a group turns escalation off", () => {
    expect(formatWeightsCaption({ driveWeight: 10, poolWeight: 3, poolStep: 0, kudosWeight: 2 })).toBe(
      "10·drive · 3·pool · 2·kudos×riders",
    );
  });
});
