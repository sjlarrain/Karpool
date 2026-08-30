import { describe, expect, it } from "vitest";
import { transition, START_WINDOW_MINUTES, type TripTransitionSnapshot } from "./tripMachine";
import type { TripStatus } from "./types";
import { TRIP_STATUS } from "./constants";

const DRIVER = "driver-1";
const OTHER = "rider-1";
const DEPART_AT = "2026-08-20T15:00:00.000Z"; // fixed anchor for T-2h math

function snapshot(status: TripStatus, departAt = DEPART_AT): TripTransitionSnapshot {
  return { status, driverId: DRIVER, departAt };
}

const ON_TIME = new Date(new Date(DEPART_AT).getTime() - START_WINDOW_MINUTES * 60_000); // exactly T-2h
const TOO_EARLY = new Date(ON_TIME.getTime() - 60_000); // one minute before the window opens

describe("tripMachine.transition — exhaustive matrix", () => {
  const events = ["start", "close", "cancel"] as const;
  const legalFrom: Record<(typeof events)[number], TripStatus> = {
    start: "scheduled",
    close: "started",
    cancel: "scheduled",
  };
  const legalTo: Record<(typeof events)[number], TripStatus> = {
    start: "started",
    close: "closed",
    cancel: "cancelled",
  };

  for (const event of events) {
    for (const status of TRIP_STATUS) {
      const isLegal = status === legalFrom[event];

      it(`${event} from ${status} by the driver ${isLegal ? "succeeds" : "is rejected (wrong_status)"}`, () => {
        // start's legality also depends on timing — use ON_TIME so this case isolates status legality.
        const result = transition(snapshot(status), event, { profileId: DRIVER }, ON_TIME);
        if (isLegal) {
          // D-35: a close now also reports which form of close the actor earned.
          expect(result).toEqual(
            event === "close"
              ? { ok: true, nextStatus: legalTo[event], closeMode: "full" }
              : { ok: true, nextStatus: legalTo[event] },
          );
        } else {
          expect(result).toEqual({ ok: false, error: "wrong_status" });
        }
      });

      it(`${event} from ${status} by an unrelated non-driver is always rejected`, () => {
        const result = transition(snapshot(status), event, { profileId: OTHER }, ON_TIME);
        // D-35 mechanic (i) opened close to riders and group admins, so a stranger attempting it
        // is now "not_permitted" rather than "not_driver". Start and cancel stay driver-only.
        expect(result).toEqual({ ok: false, error: event === "close" ? "not_permitted" : "not_driver" });
      });
    }
  }

  it("not_driver takes precedence over wrong_status for a non-driver on an illegal transition", () => {
    const result = transition(snapshot("closed"), "start", { profileId: OTHER }, ON_TIME);
    expect(result).toEqual({ ok: false, error: "not_driver" });
  });

  it("start exactly at T-2h succeeds", () => {
    const result = transition(snapshot("scheduled"), "start", { profileId: DRIVER }, ON_TIME);
    expect(result).toEqual({ ok: true, nextStatus: "started" });
  });

  it("start one minute before T-2h is rejected (too_early)", () => {
    const result = transition(snapshot("scheduled"), "start", { profileId: DRIVER }, TOO_EARLY);
    expect(result).toEqual({ ok: false, error: "too_early" });
  });

  it("start after departure has already passed succeeds (never too late, only too early)", () => {
    const afterDeparture = new Date(new Date(DEPART_AT).getTime() + 60_000);
    const result = transition(snapshot("scheduled"), "start", { profileId: DRIVER }, afterDeparture);
    expect(result).toEqual({ ok: true, nextStatus: "started" });
  });

  it("close and cancel ignore timing entirely", () => {
    expect(transition(snapshot("started"), "close", { profileId: DRIVER }, TOO_EARLY)).toEqual({
      ok: true,
      nextStatus: "closed",
      closeMode: "full",
    });
    expect(transition(snapshot("scheduled"), "cancel", { profileId: DRIVER }, TOO_EARLY)).toEqual({
      ok: true,
      nextStatus: "cancelled",
    });
  });
});

// D-35 mechanic (i) — a driver who forgets to close strands every rider who declared a return,
// because the return leg is only materialised at close. So close, and close alone, is open to the
// people who were there.
describe("tripMachine.transition — non-driver close (D-35)", () => {
  it("a rider on the trip may close it, in restricted form", () => {
    const result = transition(snapshot("started"), "close", { profileId: OTHER, isRider: true }, ON_TIME);
    expect(result).toEqual({ ok: true, nextStatus: "closed", closeMode: "restricted" });
  });

  it("a group admin may close it, in restricted form", () => {
    const result = transition(snapshot("started"), "close", { profileId: OTHER, isGroupAdmin: true }, ON_TIME);
    expect(result).toEqual({ ok: true, nextStatus: "closed", closeMode: "restricted" });
  });

  it("the driver's own close stays full even when they are also flagged a rider", () => {
    const result = transition(snapshot("started"), "close", { profileId: DRIVER, isRider: true }, ON_TIME);
    expect(result).toEqual({ ok: true, nextStatus: "closed", closeMode: "full" });
  });

  it("someone with no relationship to the trip still cannot close it", () => {
    const result = transition(snapshot("started"), "close", { profileId: OTHER }, ON_TIME);
    expect(result).toEqual({ ok: false, error: "not_permitted" });
  });

  it("opening close to riders does not open start or cancel to them", () => {
    for (const event of ["start", "cancel"] as const) {
      const result = transition(snapshot("scheduled"), event, { profileId: OTHER, isRider: true, isGroupAdmin: true }, ON_TIME);
      expect(result).toEqual({ ok: false, error: "not_driver" });
    }
  });

  it("a rider cannot close a trip that never started", () => {
    const result = transition(snapshot("scheduled"), "close", { profileId: OTHER, isRider: true }, ON_TIME);
    expect(result).toEqual({ ok: false, error: "wrong_status" });
  });
});
