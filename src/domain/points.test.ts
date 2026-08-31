import { describe, expect, it } from "vitest";
import {
  computeCloseAwards,
  seatBonus,
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

describe("seatBonus", () => {
  it("sums every seat the driver filled", () => {
    expect(seatBonus(0, 3, 2)).toBe(0);
    expect(seatBonus(1, 3, 2)).toBe(3);
    expect(seatBonus(4, 3, 2)).toBe(24); // 3 + 5 + 7 + 9
  });
});

describe("computeCloseAwards", () => {
  it("pays a lone driver the flat drive weight and nobody else", () => {
    expect(computeCloseAwards(0, WEIGHTS)).toEqual({
      driver: { kind: "drive", points: 10, reason: "Drove the trip" },
    });
  });

  // D-49: the developer's call — riding earns nothing. The close writes exactly one row, ever.
  it("returns the driver's row and nothing else, however many rode", () => {
    const awards = computeCloseAwards(4, WEIGHTS);
    expect(Object.keys(awards)).toEqual(["driver"]);
    expect(awards.driver.kind).toBe("drive");
  });

  it("folds the whole fill bonus into the driver's single drive row", () => {
    // The exact case from the developer's screenshot: one drive, four riders.
    const awards = computeCloseAwards(4, WEIGHTS);
    expect(awards.driver.points).toBe(34); // 10 + (3 + 5 + 7 + 9)
    expect(awards.driver.reason).toBe("Drove the trip (4 pooled)");
  });

  // D-49 kept D-19's economics untouched: dropping the rider's award must not quietly change what
  // a driver takes home, so these are the same totals the suite asserted before.
  it("leaves the driver's total exactly where D-42 left it", () => {
    expect(computeCloseAwards(1, WEIGHTS).driver.points).toBe(13);
    expect(computeCloseAwards(2, WEIGHTS).driver.points).toBe(18);
    expect(computeCloseAwards(3, WEIGHTS).driver.points).toBe(25);
  });

  it("counts a guest's seat toward the bonus — the caller passes seats, not profiles", () => {
    // One registered rider + one guest is two filled seats: 10 + (3 + 5).
    expect(computeCloseAwards(2, WEIGHTS).driver.points).toBe(18);
  });

  it("still makes each extra seat worth more than the last, to the driver", () => {
    const points = (n: number) => computeCloseAwards(n, WEIGHTS).driver.points;
    expect(points(2) - points(1)).toBe(5);
    expect(points(3) - points(2)).toBe(7);
  });

  it("never emits a zero-point row, which points_ledger would reject", () => {
    // check (points <> 0) on points_ledger: a zero award is not storable, so the close must not
    // produce one. With every weight at zero the drive row is the only row, and it is still the
    // caller's job never to configure a group into that state.
    const awards = computeCloseAwards(3, { driveWeight: 10, poolWeight: 0, poolStep: 0 });
    expect(awards.driver.points).toBe(10);
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
