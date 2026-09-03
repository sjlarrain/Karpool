import { describe, expect, it } from "vitest";
import { isDepartureInPast, isReturnBeforeDeparture } from "./tripSchedule";

const now = new Date("2026-09-03T12:00:00Z");

describe("isDepartureInPast", () => {
  it("flags a departure before now", () => {
    expect(isDepartureInPast("2026-09-03T11:59:00Z", now)).toBe(true);
  });

  it("allows a departure after now", () => {
    expect(isDepartureInPast("2026-09-03T12:01:00Z", now)).toBe(false);
  });

  it("allows a departure exactly now", () => {
    expect(isDepartureInPast("2026-09-03T12:00:00Z", now)).toBe(false);
  });

  it("does not flag an unparseable value — zod already rejects those upstream", () => {
    expect(isDepartureInPast("not-a-date", now)).toBe(false);
  });
});

describe("isReturnBeforeDeparture", () => {
  it("flags a return at or before departure", () => {
    expect(isReturnBeforeDeparture("2026-09-03T09:00:00Z", "2026-09-03T08:00:00Z")).toBe(true);
    expect(isReturnBeforeDeparture("2026-09-03T09:00:00Z", "2026-09-03T09:00:00Z")).toBe(true);
  });

  it("allows a return after departure", () => {
    expect(isReturnBeforeDeparture("2026-09-03T09:00:00Z", "2026-09-03T17:00:00Z")).toBe(false);
  });

  it("does not flag an unparseable value", () => {
    expect(isReturnBeforeDeparture("2026-09-03T09:00:00Z", "not-a-date")).toBe(false);
    expect(isReturnBeforeDeparture("not-a-date", "2026-09-03T09:00:00Z")).toBe(false);
  });
});
