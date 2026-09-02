import { describe, expect, it } from "vitest";
import { aggregateLedger, rankLeaderboard, formatWeightsCaption } from "./leaderboard";
import type { LedgerRow, LeaderboardEntry } from "./leaderboard";

describe("aggregateLedger", () => {
  const NO_RIDES = new Map<string, number>();

  // D-49: `driven`, `kudos` and `points` come from the ledger; `pooled` no longer does. Riding
  // earns nothing, so there is no `pool` row to count — the count is passed in, sourced from the
  // rider's confirmed seats on closed trips.
  it("sums points and counts drive/kudos entries per profile", () => {
    const rows: LedgerRow[] = [
      { profileId: "a", kind: "drive", points: 10 },
      { profileId: "a", kind: "kudos", points: 2 },
      { profileId: "b", kind: "drive", points: 10 },
    ];
    const stats = aggregateLedger(rows, new Map([["a", 2]]));
    expect(stats.get("a")).toEqual({ driven: 1, pooled: 2, kudos: 1, points: 12 });
    expect(stats.get("b")).toEqual({ driven: 1, pooled: 0, kudos: 0, points: 10 });
  });

  // The case the whole change exists for: someone who only ever rides. They hold no ledger row at
  // all, so the ledger pass never sees them — they must still appear, with their rides and a
  // score of zero. Before D-49 this person was the one reading "0 pooled" forever.
  it("shows a rider who has never driven: their rides, and no points", () => {
    const stats = aggregateLedger([], new Map([["rider", 3]]));
    expect(stats.get("rider")).toEqual({ driven: 0, pooled: 3, kudos: 0, points: 0 });
  });

  it("ignores a legacy pool row's kind but still honours its points", () => {
    // Rows written before D-49 are history and are never rewritten (CLAUDE.md §3.5: the ledger is
    // append-only). If one survives the cleanup its points still count; it just no longer drives
    // the pooled tile, which now comes from the rides.
    const rows: LedgerRow[] = [{ profileId: "a", kind: "pool", points: 3 }];
    expect(aggregateLedger(rows, new Map([["a", 1]]))).toEqual(
      new Map([["a", { driven: 0, pooled: 1, kudos: 0, points: 3 }]]),
    );
  });

  it("counts late_leave and admin_adjust toward points but not any tile", () => {
    const rows: LedgerRow[] = [
      { profileId: "a", kind: "drive", points: 10 },
      { profileId: "a", kind: "late_leave", points: -5 },
    ];
    expect(aggregateLedger(rows, NO_RIDES).get("a")).toEqual({ driven: 1, pooled: 0, kudos: 0, points: 5 });
  });

  it("returns an empty map for no rows and no rides", () => {
    expect(aggregateLedger([], NO_RIDES).size).toBe(0);
  });
});

const entry = (profileId: string, points: number, registered = true): LeaderboardEntry => ({
  profileId,
  name: profileId,
  initials: "XX",
  color: "#000",
  registered,
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
  it("names three terms: drive, the driver's seat bonus, kudos (D-49 dropped the rider's)", () => {
    expect(formatWeightsCaption({ driveWeight: 10, poolWeight: 3, poolStep: 2, kudosWeight: 2 })).toBe(
      "10·drive · 3+2/seat · 2·kudos×riders",
    );
  });

  it("reflects non-default weights", () => {
    expect(formatWeightsCaption({ driveWeight: 20, poolWeight: 5, poolStep: 4, kudosWeight: 1 })).toBe(
      "20·drive · 5+4/seat · 1·kudos×riders",
    );
  });

  it("drops the escalation wording when a group turns it off, keeping the seat term", () => {
    expect(formatWeightsCaption({ driveWeight: 10, poolWeight: 3, poolStep: 0, kudosWeight: 2 })).toBe(
      "10·drive · 3/seat · 2·kudos×riders",
    );
  });
});

describe("rankLeaderboard with unregistered guests (D-55)", () => {
  it("ranks a guest below every scoring member, since riding pays nothing", () => {
    // D-49: riders earn no points, so an unclaimed guest is always on zero and always last —
    // adding them to the board cannot disturb anyone's rank.
    const ranked = rankLeaderboard([entry("guest", 0, false), entry("driver", 10)]);
    expect(ranked.map((r) => r.profileId)).toEqual(["driver", "guest"]);
    expect(ranked.find((r) => r.profileId === "guest")?.registered).toBe(false);
  });
});
