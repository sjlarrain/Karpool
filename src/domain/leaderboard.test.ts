import { describe, expect, it } from "vitest";
import { aggregateLedger, rankLeaderboard, formatWeightsCaption, tripsInMonth } from "./leaderboard";
import type { LedgerRow, LeaderboardEntry, TripMonthInput } from "./leaderboard";

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

describe("tripsInMonth", () => {
  const AUG_START = new Date("2026-08-01T00:00:00.000Z");
  const SEP_START = new Date("2026-09-01T00:00:00.000Z");
  const OCT_START = new Date("2026-10-01T00:00:00.000Z");

  // The live case, and the reason the first version of this was wrong. A round trip sets off on
  // 31 August and its return leg closes just after midnight UTC on 1 September. Both legs are one
  // ride, and the ride's points are written when it CLOSES — so on 1 September the driver must see
  // the whole ride on their line, not zero. Anchoring on the outbound's departure put it in August
  // and blanked the driver's current-month score the morning after they drove.
  it("puts BOTH legs in the month the ride finished, not the month it set off", () => {
    const trips: TripMonthInput[] = [
      { id: "out", parentTripId: null, closedAt: "2026-08-31T21:20:00.000Z" },
      { id: "back", parentTripId: "out", closedAt: "2026-09-01T04:38:00.000Z" },
    ];
    expect(tripsInMonth(trips, SEP_START, OCT_START).sort()).toEqual(["back", "out"]);
    // And nothing is left behind in August — a ride is counted once, in exactly one month.
    expect(tripsInMonth(trips, AUG_START, SEP_START)).toEqual([]);
  });

  it("keeps an ordinary same-day round trip whole, in its own month", () => {
    const trips: TripMonthInput[] = [
      { id: "out", parentTripId: null, closedAt: "2026-09-10T08:30:00.000Z" },
      { id: "back", parentTripId: "out", closedAt: "2026-09-10T18:10:00.000Z" },
    ];
    expect(tripsInMonth(trips, SEP_START, OCT_START).sort()).toEqual(["back", "out"]);
  });

  it("a one-way trip is its own anchor", () => {
    const trips: TripMonthInput[] = [{ id: "solo", parentTripId: null, closedAt: "2026-08-15T09:00:00.000Z" }];
    expect(tripsInMonth(trips, AUG_START, SEP_START)).toEqual(["solo"]);
  });

  it("excludes a ride that finished outside the window", () => {
    const trips: TripMonthInput[] = [{ id: "solo", parentTripId: null, closedAt: "2026-07-31T23:59:59.000Z" }];
    expect(tripsInMonth(trips, AUG_START, SEP_START)).toEqual([]);
  });

  // An outbound still open while its back leg has closed cannot happen through the app (the back
  // leg only exists because the outbound closed), but the window must not invent an anchor if it
  // ever does — the ride is anchored on whatever HAS closed.
  it("anchors on the legs that have actually closed, ignoring an unclosed one", () => {
    const trips: TripMonthInput[] = [
      { id: "out", parentTripId: null, closedAt: null },
      { id: "back", parentTripId: "out", closedAt: "2026-09-02T04:00:00.000Z" },
    ];
    expect(tripsInMonth(trips, SEP_START, OCT_START).sort()).toEqual(["back", "out"]);
  });

  it("skips a ride with nothing closed at all — there is nothing to score", () => {
    const trips: TripMonthInput[] = [{ id: "open", parentTripId: null, closedAt: null }];
    expect(tripsInMonth(trips, SEP_START, OCT_START)).toEqual([]);
  });

  it("falls back to its own close time if the parent is somehow missing from the set", () => {
    const trips: TripMonthInput[] = [{ id: "orphan", parentTripId: "ghost", closedAt: "2026-08-10T00:00:00.000Z" }];
    expect(tripsInMonth(trips, AUG_START, SEP_START)).toEqual(["orphan"]);
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
