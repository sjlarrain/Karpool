import { describe, expect, it } from "vitest";
import { toTripView, deriveRole } from "./toTripView";
import type { TripRiderRowInput, TripRowInput } from "./toTripView";

const NOW = new Date("2026-08-17T12:00:00");

const trip: TripRowInput = {
  id: "trip-1",
  direction: "out",
  departAt: "2026-08-17T07:45:00",
  returnAt: null,
  capacity: 3,
  status: "scheduled",
  driverId: "driver-1",
};

const driver = { id: "driver-1", displayName: "Marco Lee" };

const rider: TripRiderRowInput = {
  profileId: "rider-1",
  guestName: null,
  displayName: "Alex Morgan",
  initials: "AM",
  avatarColor: "var(--purple)",
};

const guest: TripRiderRowInput = {
  profileId: null,
  guestName: "Sam Guest",
  displayName: null,
  initials: null,
  avatarColor: null,
};

describe("deriveRole", () => {
  it("is driving for the driver", () => {
    expect(deriveRole("driver-1", [], "driver-1")).toBe("driving");
  });
  it("is joined for an active rider", () => {
    expect(deriveRole("driver-1", [rider], "rider-1")).toBe("joined");
  });
  it("is open for anyone else", () => {
    expect(deriveRole("driver-1", [rider], "someone-else")).toBe("open");
  });
});

describe("toTripView", () => {
  it("maps a scheduled trip for the driving viewer", () => {
    const view = toTripView({
      trip,
      driver,
      activeRiders: [rider],
      viewerId: "driver-1",
      originLabel: "Riverside",
      destLabel: "HQ",
      now: NOW,
    });
    expect(view.role).toBe("driving");
    expect(view.driver).toBe("You");
    expect(view.from).toBe("Riverside");
    expect(view.to).toBe("HQ");
    expect(view.dayLabel).toBe("Today · Mon 17");
    expect(view.time).toBe("7:45");
    expect(view.riders).toEqual([{ name: "Alex Morgan", initials: "AM", color: "var(--purple)" }]);
  });

  it("flips from/to for a 'back' direction leg", () => {
    const view = toTripView({
      trip: { ...trip, direction: "back" },
      driver,
      activeRiders: [],
      viewerId: "someone-else",
      originLabel: "Riverside",
      destLabel: "HQ",
      now: NOW,
    });
    expect(view.from).toBe("HQ");
    expect(view.to).toBe("Riverside");
    expect(view.driver).toBe("Marco Lee");
    expect(view.role).toBe("open");
  });

  it("computes initials and a stable color for a guest rider", () => {
    const view = toTripView({
      trip,
      driver,
      activeRiders: [guest],
      viewerId: "someone-else",
      originLabel: "Riverside",
      destLabel: "HQ",
      now: NOW,
    });
    expect(view.riders).toEqual([{ name: "Sam Guest", initials: "SG", color: expect.any(String) }]);
  });

  it("formats a return time when present", () => {
    const view = toTripView({
      trip: { ...trip, returnAt: "2026-08-17T17:30:00" },
      driver,
      activeRiders: [],
      viewerId: "someone-else",
      originLabel: "Riverside",
      destLabel: "HQ",
      now: NOW,
    });
    expect(view.returnTime).toBe("17:30");
  });
});

describe("departure state (D-23)", () => {
  const view = (departAt: string, extra: Partial<TripRowInput> = {}) =>
    toTripView({
      trip: { ...trip, departAt, ...extra },
      driver,
      activeRiders: [],
      viewerId: "someone-else",
      originLabel: "Riverside",
      destLabel: "HQ",
      now: NOW,
    });

  it("marks a trip whose departure time has passed", () => {
    // NOW is 12:00; this trip left at 07:45.
    expect(view("2026-08-17T07:45:00").departed).toBe(true);
  });

  it("leaves a trip that hasn't left yet un-departed", () => {
    expect(view("2026-08-17T17:45:00").departed).toBe(false);
  });

  it("carries the cancellation reason through so the UI can tell expiry from a driver cancelling", () => {
    expect(view("2026-08-17T07:45:00", { status: "cancelled", cancelledReason: "not_started" }).cancelledReason).toBe(
      "not_started",
    );
    expect(view("2026-08-17T07:45:00").cancelledReason).toBeNull();
  });
});
