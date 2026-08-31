import { describe, expect, it } from "vitest";
import { shouldGenerateBackLeg, kudosPromptTargets, rideRiderCount, isReturnLegDue } from "./backLeg";
import { computeKudosAward } from "./points";

describe("shouldGenerateBackLeg", () => {
  const RETURN_AT = "2026-08-30T18:00:00.000Z";

  it("a round trip with a return time has a leg to materialise", () => {
    expect(shouldGenerateBackLeg({ direction: "round", returnAt: RETURN_AT })).toBe(true);
  });

  it("a one-way trip never does — it is already the whole ride", () => {
    expect(shouldGenerateBackLeg({ direction: "out", returnAt: null })).toBe(false);
    expect(shouldGenerateBackLeg({ direction: "back", returnAt: null })).toBe(false);
  });

  it("a round trip with no return time does not, so a half-filled row cannot spawn a leg at an unknown hour", () => {
    expect(shouldGenerateBackLeg({ direction: "round", returnAt: null })).toBe(false);
  });

  it("a leg that already exists is not generated twice", () => {
    expect(shouldGenerateBackLeg({ direction: "round", returnAt: RETURN_AT, hasBackLeg: true })).toBe(false);
  });
});

// D-35 answer (B): one kudos prompt per rider per RIDE, fired when that rider's ride is over.
describe("kudosPromptTargets", () => {
  it("prompts the riders who are not coming back — for them the ride ended at this close", () => {
    expect(
      kudosPromptTargets({
        confirmedProfileIds: ["ana", "ben", "cleo"],
        seatedOnBackLegProfileIds: ["ben"],
      }),
    ).toEqual(["ana", "cleo"]);
  });

  it("leaves a returning rider alone, so they are asked once at the end rather than twice in a day", () => {
    expect(
      kudosPromptTargets({
        confirmedProfileIds: ["ana", "ben"],
        seatedOnBackLegProfileIds: ["ana", "ben"],
      }),
    ).toEqual([]);
  });

  it("prompts everyone when no return leg was generated — a one-way close is unchanged", () => {
    expect(
      kudosPromptTargets({
        confirmedProfileIds: ["ana", "ben"],
        seatedOnBackLegProfileIds: [],
      }),
    ).toEqual(["ana", "ben"]);
  });

  it("preserves the order it was given, so the notification batch is deterministic", () => {
    expect(
      kudosPromptTargets({
        confirmedProfileIds: ["cleo", "ana", "ben"],
        seatedOnBackLegProfileIds: ["ana"],
      }),
    ).toEqual(["cleo", "ben"]);
  });
});

describe("rideRiderCount", () => {
  it("is the fuller leg, so a driver is not paid less because someone walked home", () => {
    expect(rideRiderCount(3, 2)).toBe(3);
  });

  it("is symmetric — a leg that filled up on the way back counts just as much", () => {
    expect(rideRiderCount(1, 3)).toBe(3);
  });

  it("handles a one-way ride, where there is no second leg to compare", () => {
    expect(rideRiderCount(2, 0)).toBe(2);
  });

  it("feeds computeKudosAward the fuller car, not the emptier one", () => {
    const weights = 2;
    const outThreeBackOne = computeKudosAward(weights, rideRiderCount(3, 1));
    const straightThree = computeKudosAward(weights, 3);
    expect(outThreeBackOne).toEqual(straightThree);
  });
});

// D-35 mechanic (ii): the scheduler stops waiting for the driver this long before the RETURN
// departure, not the outbound one — the deadline exists so a rider still has time to arrange
// something else if their seat home never materialised.
describe("isReturnLegDue", () => {
  const RETURN_AT = "2026-08-30T18:00:00.000Z";
  const LEAD = 120;
  const at = (iso: string) => new Date(iso);

  it("is not due three hours out", () => {
    expect(isReturnLegDue(RETURN_AT, at("2026-08-30T15:00:00.000Z"), LEAD)).toBe(false);
  });

  it("is due exactly at the deadline — the boundary is inclusive, so a tick landing on it acts", () => {
    expect(isReturnLegDue(RETURN_AT, at("2026-08-30T16:00:00.000Z"), LEAD)).toBe(true);
  });

  it("is not due one minute before the deadline", () => {
    expect(isReturnLegDue(RETURN_AT, at("2026-08-30T15:59:00.000Z"), LEAD)).toBe(false);
  });

  it("stays due after the deadline passes, so a missed tick still catches up", () => {
    expect(isReturnLegDue(RETURN_AT, at("2026-08-30T17:30:00.000Z"), LEAD)).toBe(true);
  });

  it("is still due after the return itself has departed — better a late leg than none", () => {
    expect(isReturnLegDue(RETURN_AT, at("2026-08-30T19:00:00.000Z"), LEAD)).toBe(true);
  });

  it("measures against the return, not the outbound — a lead of 0 fires only at the return time", () => {
    expect(isReturnLegDue(RETURN_AT, at("2026-08-30T17:59:00.000Z"), 0)).toBe(false);
    expect(isReturnLegDue(RETURN_AT, at("2026-08-30T18:00:00.000Z"), 0)).toBe(true);
  });
});
