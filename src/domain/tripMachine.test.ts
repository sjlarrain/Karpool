import { describe, expect, it } from "vitest";
import { transition, type TripTransitionSnapshot } from "./tripMachine";
import type { TripStatus } from "./types";
import { TRIP_STATUS } from "./constants";

const DRIVER = "driver-1";
const OTHER = "rider-1";
const DEPART_AT = "2026-08-20T15:00:00.000Z";

function snapshot(status: TripStatus, departAt = DEPART_AT): TripTransitionSnapshot {
  return { status, driverId: DRIVER, departAt };
}

const BEFORE = new Date(new Date(DEPART_AT).getTime() - 60_000);
const AT_DEPARTURE = new Date(DEPART_AT);
const AFTER = new Date(new Date(DEPART_AT).getTime() + 60_000);

// D-61: the scheduler settles a trip at its departure; the driver can only cancel before it.
describe("tripMachine.transition — exhaustive matrix (D-61)", () => {
  for (const status of TRIP_STATUS) {
    it(`settle from ${status} by the scheduler after departure`, () => {
      const result = transition(snapshot(status), "settle", { isSystem: true }, AFTER);
      expect(result).toEqual(
        status === "scheduled" ? { ok: true, nextStatus: "closed" } : { ok: false, error: "wrong_status" },
      );
    });

    it(`cancel from ${status} by the driver before departure`, () => {
      const result = transition(snapshot(status), "cancel", { profileId: DRIVER }, BEFORE);
      expect(result).toEqual(
        status === "scheduled" ? { ok: true, nextStatus: "cancelled" } : { ok: false, error: "wrong_status" },
      );
    });

    it(`nobody but the scheduler may settle from ${status}`, () => {
      for (const actor of [{ profileId: DRIVER }, { profileId: OTHER }, {}]) {
        expect(transition(snapshot(status), "settle", actor, AFTER)).toEqual({ ok: false, error: "not_permitted" });
      }
    });

    it(`nobody but the driver may cancel from ${status}`, () => {
      for (const actor of [{ profileId: OTHER }, { isSystem: true }, {}]) {
        expect(transition(snapshot(status), "cancel", actor, BEFORE)).toEqual({ ok: false, error: "not_driver" });
      }
    });
  }
});

describe("tripMachine.transition — departure is the hinge (D-61)", () => {
  it("settling before departure is too early", () => {
    expect(transition(snapshot("scheduled"), "settle", { isSystem: true }, BEFORE)).toEqual({
      ok: false,
      error: "too_early",
    });
  });

  it("settling exactly at departure succeeds", () => {
    expect(transition(snapshot("scheduled"), "settle", { isSystem: true }, AT_DEPARTURE)).toEqual({
      ok: true,
      nextStatus: "closed",
    });
  });

  it("a trip cannot be cancelled once it has departed", () => {
    expect(transition(snapshot("scheduled"), "cancel", { profileId: DRIVER }, AT_DEPARTURE)).toEqual({
      ok: false,
      error: "departed",
    });
  });

  it("wrong_status is reported before timing, so a closed trip never reads as 'too early'", () => {
    expect(transition(snapshot("closed"), "settle", { isSystem: true }, BEFORE)).toEqual({
      ok: false,
      error: "wrong_status",
    });
  });
});
