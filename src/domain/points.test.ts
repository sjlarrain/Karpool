import { describe, expect, it } from "vitest";
import {
  computeDriveAward,
  computeDriveCorrection,
  seatBonus,
  computeKudosAward,
  computeLateLeavePenalty,
  computeNoShowPenalty,
  computeNoShowReport,
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

describe("computeDriveAward", () => {
  it("pays a lone driver the flat drive weight and nobody else", () => {
    expect(computeDriveAward(0, WEIGHTS)).toEqual({ kind: "drive", points: 10, reason: "Drove the trip" });
  });

  it("folds the whole fill bonus into the driver's single drive row", () => {
    // The exact case from the developer's screenshot: one drive, four riders.
    const award = computeDriveAward(4, WEIGHTS);
    expect(award.points).toBe(34); // 10 + (3 + 5 + 7 + 9)
    expect(award.reason).toBe("Drove the trip (4 pooled)");
  });

  // D-49 kept D-19's economics untouched, and D-56 only moved when the row is written — so these
  // are the same totals the suite has asserted since D-42.
  it("leaves the driver's total exactly where D-42 left it", () => {
    expect(computeDriveAward(1, WEIGHTS).points).toBe(13);
    expect(computeDriveAward(2, WEIGHTS).points).toBe(18);
    expect(computeDriveAward(3, WEIGHTS).points).toBe(25);
  });

  it("counts a guest's seat toward the bonus — the caller passes seats, not profiles", () => {
    // One registered rider + one guest is two filled seats: 10 + (3 + 5).
    expect(computeDriveAward(2, WEIGHTS).points).toBe(18);
  });

  it("still makes each extra seat worth more than the last, to the driver", () => {
    const points = (n: number) => computeDriveAward(n, WEIGHTS).points;
    expect(points(2) - points(1)).toBe(5);
    expect(points(3) - points(2)).toBe(7);
  });

  it("never emits a zero-point row, which points_ledger would reject", () => {
    // check (points <> 0) on points_ledger: a zero award is not storable, so the award must not
    // produce one. With every pooling weight at zero the drive weight is all that is left, and it
    // is still the caller's job never to configure a group into an all-zero state.
    expect(computeDriveAward(3, { driveWeight: 10, poolWeight: 0, poolStep: 0 }).points).toBe(10);
  });
});

// D-56. The driver is paid at Start off a forecast; every later change to the roster re-prices the
// ride and appends the difference.
describe("computeDriveCorrection", () => {
  it("writes nothing when the seat count hasn't moved since Start", () => {
    // Paid 18 for two seats, still two seats: nothing is owed, and a zero-point row is not storable.
    expect(computeDriveCorrection(18, 2, WEIGHTS)).toEqual({ entry: null, total: 18 });
  });

  it("tops the driver up for someone who got in at the kerb", () => {
    // Started with one rider (13), a second climbs in: the second seat is worth 5.
    const { entry, total } = computeDriveCorrection(13, 2, WEIGHTS);
    expect(total).toBe(18);
    expect(entry).toEqual({ kind: "drive_adjust", points: 5, reason: "Seat count corrected (2 pooled)" });
  });

  it("takes the bonus back off the driver when a rider doesn't ride", () => {
    // Paid for two, one is marked a no-show at close: the driver keeps 13, not 18.
    const { entry, total } = computeDriveCorrection(18, 1, WEIGHTS);
    expect(total).toBe(13);
    expect(entry).toEqual({ kind: "drive_adjust", points: -5, reason: "Seat count corrected (1 pooled)" });
  });

  it("names the solo case rather than saying '0 pooled'", () => {
    expect(computeDriveCorrection(13, 0, WEIGHTS).entry?.reason).toBe("Seat count corrected (drove alone)");
  });

  it("is a correction, never a `drive` row — a second drive row would count as a second trip driven", () => {
    expect(computeDriveCorrection(0, 2, WEIGHTS).entry?.kind).toBe("drive_adjust");
  });

  // The property that makes this safe to call from six routes and the scheduler: it is derived from
  // what is already on the ledger, so calling it again after it has been applied owes nothing.
  it("cannot double-pay when applied twice", () => {
    const first = computeDriveCorrection(13, 3, WEIGHTS);
    expect(first.entry?.points).toBe(12);
    const second = computeDriveCorrection(13 + 12, 3, WEIGHTS);
    expect(second.entry).toBeNull();
    expect(second.total).toBe(25);
  });

  // A trip that started before D-56 shipped has no `drive` row at all; its close must still pay the
  // whole award rather than half of one.
  it("pays the full award when nothing has been paid yet", () => {
    expect(computeDriveCorrection(0, 1, WEIGHTS).entry?.points).toBe(13);
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

});

// D-61: the driver reports a no-show after the ride; the rider pays, the driver is paid for telling.
describe("computeNoShowReport", () => {
  it("charges the rider and pays the driver, at the D-61 defaults (-5 / +2)", () => {
    expect(computeNoShowReport(-5, 2)).toEqual({
      rider: { kind: "no_show", points: -5, reason: "Booked a seat and didn't ride" },
      driver: { kind: "no_show_report", points: 2, reason: "Reported a no-show" },
    });
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
