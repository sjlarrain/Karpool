import { describe, expect, it } from "vitest";
import { canCorrect, correctionWindowEnd, isSettleDue } from "./tripSettle";

const LA = "America/Los_Angeles";

describe("isSettleDue (D-61)", () => {
  const depart = "2026-09-18T15:00:00.000Z";
  it("is not due before departure", () => {
    expect(isSettleDue(depart, new Date("2026-09-18T14:59:59.000Z"))).toBe(false);
  });
  it("is due at and after departure", () => {
    expect(isSettleDue(depart, new Date(depart))).toBe(true);
    expect(isSettleDue(depart, new Date("2026-09-20T00:00:00.000Z"))).toBe(true);
  });
  it("is never due for an unparseable time", () => {
    expect(isSettleDue("nope", new Date())).toBe(false);
  });
});

describe("correctionWindowEnd (D-61)", () => {
  it("ends at the next local midnight — 08:10 PDT closes at 00:00 PDT (07:00Z) the next day", () => {
    expect(correctionWindowEnd("2026-09-18T15:10:00.000Z", LA).toISOString()).toBe("2026-09-19T07:00:00.000Z");
  });

  it("uses the LOCAL day, not the UTC one — a 20:00 PDT departure is already the next day in UTC", () => {
    expect(correctionWindowEnd("2026-09-19T03:00:00.000Z", LA).toISOString()).toBe("2026-09-19T07:00:00.000Z");
  });

  it("is plain UTC midnight in UTC", () => {
    expect(correctionWindowEnd("2026-09-18T15:10:00.000Z", "UTC").toISOString()).toBe("2026-09-19T00:00:00.000Z");
  });

  it("handles the night DST ends (Nov 1 2026 in LA: midnight is still PDT)", () => {
    expect(correctionWindowEnd("2026-10-31T16:00:00.000Z", LA).toISOString()).toBe("2026-11-01T07:00:00.000Z");
  });

  it("handles the day DST ends (Nov 1 2026: the next midnight is PST)", () => {
    expect(correctionWindowEnd("2026-11-01T17:00:00.000Z", LA).toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });

  it("handles the day DST starts (Mar 8 2026: the next midnight is PDT)", () => {
    expect(correctionWindowEnd("2026-03-08T18:00:00.000Z", LA).toISOString()).toBe("2026-03-09T07:00:00.000Z");
  });
});

describe("canCorrect (D-61)", () => {
  const departAt = "2026-09-18T15:10:00.000Z";
  it("is open on a closed trip until local midnight", () => {
    expect(canCorrect({ status: "closed", departAt }, new Date("2026-09-19T06:59:59.000Z"), LA)).toBe(true);
    expect(canCorrect({ status: "closed", departAt }, new Date("2026-09-19T07:00:00.000Z"), LA)).toBe(false);
  });
  it("is never open on a trip that has not settled, or was cancelled", () => {
    const now = new Date("2026-09-18T16:00:00.000Z");
    expect(canCorrect({ status: "scheduled", departAt }, now, LA)).toBe(false);
    expect(canCorrect({ status: "cancelled", departAt }, now, LA)).toBe(false);
  });
});
