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

const WEIGHTS = { driveWeight: 10, poolWeight: 3, poolStep: 2, riderPoolWeight: 3 };

const rider = (name: string, profileId: string | null = `p-${name}`) => ({ profileId, name });
const guest = (name: string) => ({ profileId: null, name });

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
    expect(computeCloseAwards([], WEIGHTS)).toEqual({
      driver: { kind: "drive", points: 10, reason: "Drove the trip" },
      riders: [],
    });
  });

  it("gives the driver NO pool row — they drove, they were not pooled (D-42)", () => {
    const awards = computeCloseAwards([rider("Alex"), rider("Sam")], WEIGHTS);
    expect(awards.driver.kind).toBe("drive");
    expect(awards.riders.map((r) => r.profileId)).toEqual(["p-Alex", "p-Sam"]);
  });

  it("folds the whole fill bonus into the driver's single drive row", () => {
    // The exact case from the developer's screenshot: one drive, four riders.
    const awards = computeCloseAwards([rider("A"), rider("B"), rider("C"), rider("D")], WEIGHTS);
    expect(awards.driver.points).toBe(34); // 10 + (3 + 5 + 7 + 9)
    expect(awards.driver.reason).toBe("Drove the trip (4 pooled)");
  });

  it("pays each rider a flat pooled award, however full the car was", () => {
    const awards = computeCloseAwards([rider("A"), rider("B"), rider("C")], WEIGHTS);
    expect(awards.riders.map((r) => r.award.points)).toEqual([3, 3, 3]);
  });

  it("names the driver on the rider's row when one is given", () => {
    const awards = computeCloseAwards([rider("A")], WEIGHTS, "Alejandro Rivera");
    expect(awards.riders[0]!.award.reason).toBe("Pooled with Alejandro Rivera");
    expect(computeCloseAwards([rider("A")], WEIGHTS).riders[0]!.award.reason).toBe("Pooled on a trip");
  });

  it("lets a guest pay the driver's bonus but earn nothing themselves", () => {
    const awards = computeCloseAwards([rider("Alex"), guest("Sam Guest")], WEIGHTS);
    expect(awards.driver.points).toBe(18); // 10 + (3 + 5) — the guest filled the second seat
    expect(awards.riders).toHaveLength(1);
    expect(awards.riders[0]!.profileId).toBe("p-Alex");
  });

  it("still makes each extra seat worth more than the last, to the driver", () => {
    const points = (n: number) =>
      computeCloseAwards(Array.from({ length: n }, (_, i) => rider(String(i))), WEIGHTS).driver.points;
    expect(points(2) - points(1)).toBe(5);
    expect(points(3) - points(2)).toBe(7);
  });

  it("uses the group's configured weights, not the domain defaults", () => {
    const awards = computeCloseAwards([rider("A"), rider("B")], {
      driveWeight: 20,
      poolWeight: 5,
      poolStep: 4,
      riderPoolWeight: 7,
    });
    expect(awards.driver.points).toBe(34); // 20 + (5 + 9)
    expect(awards.riders.map((r) => r.award.points)).toEqual([7, 7]);
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
