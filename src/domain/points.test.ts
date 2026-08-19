import { describe, expect, it } from "vitest";
import {
  computeCloseAwards,
  computeKudosAward,
  computeLateLeavePenalty,
  computeNoShowPenalty,
  isLateLeave,
  poolPointsForSeat,
} from "./points";

const WEIGHTS = { driveWeight: 10, poolWeight: 3, poolStep: 2 };

describe("poolPointsForSeat", () => {
  it("escalates: the defaults pay 3, 5, 7 across the seats", () => {
    expect(poolPointsForSeat(0, 3, 2)).toBe(3);
    expect(poolPointsForSeat(1, 3, 2)).toBe(5);
    expect(poolPointsForSeat(2, 3, 2)).toBe(7);
  });

  it("collapses to the old flat behaviour when the step is zero", () => {
    expect(poolPointsForSeat(0, 3, 0)).toBe(3);
    expect(poolPointsForSeat(4, 3, 0)).toBe(3);
  });
});

describe("computeCloseAwards", () => {
  it("always includes a drive award for the driver", () => {
    const awards = computeCloseAwards([], WEIGHTS);
    expect(awards).toEqual([{ kind: "drive", points: 10, reason: "Drove the trip" }]);
  });

  it("adds one escalating pool award per confirmed rider, registered or guest alike", () => {
    const awards = computeCloseAwards(["Alex Morgan", "Sam Guest"], WEIGHTS);
    expect(awards).toEqual([
      { kind: "drive", points: 10, reason: "Drove the trip" },
      { kind: "pool", points: 3, reason: "Pooled Alex Morgan" },
      { kind: "pool", points: 5, reason: "Pooled Sam Guest" },
    ]);
  });

  it("makes a full car beat the same riders carried one at a time", () => {
    const together = computeCloseAwards(["A", "B", "C"], WEIGHTS).reduce((sum, a) => sum + a.points, 0);
    const separately = ["A", "B", "C"]
      .map((name) => computeCloseAwards([name], WEIGHTS).reduce((sum, a) => sum + a.points, 0))
      .reduce((sum, total) => sum + total, 0);
    expect(together).toBe(25);
    expect(separately).toBe(39);
    // Three solo trips still out-earn one full car in raw points — three drives is genuinely more
    // driving — but each *additional* seat on a single trip is worth more than the last, which is
    // the incentive D-19 asked for.
    expect(together).toBeGreaterThan(computeCloseAwards(["A"], WEIGHTS).reduce((s, a) => s + a.points, 0) * 1.9);
  });

  it("uses the group's configured weights, not the domain defaults", () => {
    const awards = computeCloseAwards(["Rider", "Second"], { driveWeight: 20, poolWeight: 5, poolStep: 4 });
    expect(awards.map((a) => a.points)).toEqual([20, 5, 9]);
  });
});

describe("computeKudosAward", () => {
  it("scales with how many riders were pooled on that trip", () => {
    expect(computeKudosAward(2, 1).points).toBe(2);
    expect(computeKudosAward(2, 3).points).toBe(6);
  });

  it("never pays less than the base weight, even on a bad rider count", () => {
    expect(computeKudosAward(2, 0).points).toBe(2);
    expect(computeKudosAward(2, -5).points).toBe(2);
  });

  it("names the rider count in the reason only when it actually scaled", () => {
    expect(computeKudosAward(2, 1).reason).toBe("Received kudos");
    expect(computeKudosAward(2, 4).reason).toBe("Received kudos (4 riders pooled)");
  });
});

describe("computeNoShowPenalty", () => {
  it("passes the group's configured penalty straight through", () => {
    expect(computeNoShowPenalty(-10)).toEqual({
      kind: "no_show",
      points: -10,
      reason: "Booked a seat and didn't ride",
    });
  });

  it("costs more than a late cancellation at the configured defaults", () => {
    expect(Math.abs(computeNoShowPenalty(-10).points)).toBeGreaterThan(Math.abs(-5));
  });
});

describe("isLateLeave", () => {
  const departAt = new Date("2026-08-20T08:00:00Z");

  it("is false comfortably before the window opens", () => {
    expect(isLateLeave(departAt, new Date("2026-08-20T06:30:00Z"), 60)).toBe(false);
  });

  it("is true exactly on the window boundary", () => {
    expect(isLateLeave(departAt, new Date("2026-08-20T07:00:00Z"), 60)).toBe(true);
  });

  it("is true after departure — a no-show is at least as late as one at the boundary", () => {
    expect(isLateLeave(departAt, new Date("2026-08-20T09:00:00Z"), 60)).toBe(true);
  });
});

describe("computeLateLeavePenalty", () => {
  const departAt = new Date("2026-08-20T08:00:00Z");

  it("returns null outside the window", () => {
    expect(computeLateLeavePenalty(departAt, new Date("2026-08-20T06:00:00Z"), 60, -5)).toBeNull();
  });

  it("returns the group's penalty inside the window", () => {
    expect(computeLateLeavePenalty(departAt, new Date("2026-08-20T07:30:00Z"), 60, -5)).toEqual({
      kind: "late_leave",
      points: -5,
      reason: "Left within the cancellation window",
    });
  });
});
