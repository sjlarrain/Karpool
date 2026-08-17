import { describe, expect, it } from "vitest";
import { computeCloseAwards, computeLateLeavePenalty, isLateLeave } from "./points";

const WEIGHTS = { driveWeight: 10, poolWeight: 3 };

describe("computeCloseAwards", () => {
  it("always includes a drive award for the driver", () => {
    const awards = computeCloseAwards([], WEIGHTS);
    expect(awards).toEqual([{ kind: "drive", points: 10, reason: "Drove the trip" }]);
  });

  it("adds one pool award per confirmed rider, registered or guest alike", () => {
    const awards = computeCloseAwards(["Alex Morgan", "Sam Guest"], WEIGHTS);
    expect(awards).toEqual([
      { kind: "drive", points: 10, reason: "Drove the trip" },
      { kind: "pool", points: 3, reason: "Pooled Alex Morgan" },
      { kind: "pool", points: 3, reason: "Pooled Sam Guest" },
    ]);
  });

  it("uses the group's configured weights, not the domain defaults", () => {
    const awards = computeCloseAwards(["Rider"], { driveWeight: 20, poolWeight: 5 });
    expect(awards[0]?.points).toBe(20);
    expect(awards[1]?.points).toBe(5);
  });
});

describe("isLateLeave", () => {
  const departAt = new Date("2026-08-20T08:00:00Z");

  it("is not late well before the window opens", () => {
    const now = new Date("2026-08-20T06:00:00Z"); // 2h before departure, 60min window
    expect(isLateLeave(departAt, now, 60)).toBe(false);
  });

  it("is late exactly at the window boundary", () => {
    const now = new Date("2026-08-20T07:00:00Z"); // exactly 60min before departure
    expect(isLateLeave(departAt, now, 60)).toBe(true);
  });

  it("is late one minute inside the window", () => {
    const now = new Date("2026-08-20T07:01:00Z");
    expect(isLateLeave(departAt, now, 60)).toBe(true);
  });

  it("is late after departure has already passed", () => {
    const now = new Date("2026-08-20T09:00:00Z");
    expect(isLateLeave(departAt, now, 60)).toBe(true);
  });

  it("respects a per-group custom window", () => {
    const now = new Date("2026-08-20T07:45:00Z"); // 15min before departure
    expect(isLateLeave(departAt, now, 10)).toBe(false);
    expect(isLateLeave(departAt, now, 30)).toBe(true);
  });
});

describe("computeLateLeavePenalty", () => {
  const departAt = new Date("2026-08-20T08:00:00Z");

  it("returns null when leaving well in advance", () => {
    const now = new Date("2026-08-20T06:00:00Z");
    expect(computeLateLeavePenalty(departAt, now, 60, -5)).toBeNull();
  });

  it("returns a late_leave award when inside the window", () => {
    const now = new Date("2026-08-20T07:30:00Z");
    expect(computeLateLeavePenalty(departAt, now, 60, -5)).toEqual({
      kind: "late_leave",
      points: -5,
      reason: "Left within the cancellation window",
    });
  });

  it("uses the group's configured penalty, not the domain default", () => {
    const now = new Date("2026-08-20T07:30:00Z");
    expect(computeLateLeavePenalty(departAt, now, 60, -10)?.points).toBe(-10);
  });
});
