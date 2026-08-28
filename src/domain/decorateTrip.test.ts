import { describe, expect, it } from "vitest";
import { decorateTrip } from "./decorateTrip";
import type { TripView } from "./types";

const base: TripView = {
  id: "t1",
  dayLabel: "Today · Mon 18",
  time: "7:45",
  from: "Riverside",
  to: "HQ",
  role: "open",
  driver: "Marco Lee",
  capacity: 3,
  returnTime: "17:30",
  status: "scheduled",
  departed: false,
  cancelledReason: null,
  direction: "round",
  outStop: null,
  backStop: null,
  riders: [{ name: "Marco Lee", initials: "ML", color: "#0ea5b0" }],
};

describe("decorateTrip", () => {
  it("badges an open trip with seats left as OPEN · N SEATS", () => {
    const d = decorateTrip(base);
    expect(d.badge).toBe("OPEN · 2 SEATS");
    expect(d.joinable).toBe(true);
    expect(d.seatStr).toBe("1 / 3 seats");
  });

  it("badges a full open trip as FULL and not joinable", () => {
    const full: TripView = {
      ...base,
      capacity: 1,
      riders: [{ name: "Marco Lee", initials: "ML", color: "#0ea5b0" }],
    };
    const d = decorateTrip(full);
    expect(d.badge).toBe("FULL");
    expect(d.joinable).toBe(false);
  });

  it("badges a driving trip as YOU'RE DRIVING regardless of seats left", () => {
    const driving: TripView = { ...base, role: "driving" };
    const d = decorateTrip(driving);
    expect(d.badge).toBe("YOU'RE DRIVING");
    expect(d.joinable).toBe(false);
    expect(d.driverLabel).toBe("You’re driving");
  });

  it("badges a joined trip as JOINED and labels the actual driver", () => {
    const joined: TripView = { ...base, role: "joined" };
    const d = decorateTrip(joined);
    expect(d.badge).toBe("JOINED");
    expect(d.driverLabel).toBe("Marco Lee is driving");
  });

  it("stops a departed trip being joinable, while the driver may still start it late", () => {
    // D-23: the 24h grace window is the driver's, not a late rider's.
    const d = decorateTrip({ ...base, departed: true });
    expect(d.joinable).toBe(false);
    expect(d.isPast).toBe(false);
  });

  it("badges a closed trip as COMPLETED, outranking the viewer's role", () => {
    const d = decorateTrip({ ...base, role: "driving", status: "closed" });
    expect(d.badge).toBe("COMPLETED");
    expect(d.isPast).toBe(true);
    expect(d.joinable).toBe(false);
  });

  it("distinguishes a driver cancelling from a trip nobody started", () => {
    expect(decorateTrip({ ...base, status: "cancelled" }).badge).toBe("CANCELLED");
    expect(decorateTrip({ ...base, status: "cancelled", cancelledReason: "not_started" }).badge).toBe(
      "PAST · NEVER STARTED",
    );
  });

  it("pads avatars with dashed placeholders up to capacity, capped at 4", () => {
    const d = decorateTrip({ ...base, capacity: 6 });
    expect(d.avatars).toHaveLength(4);
    expect(d.avatars[0]?.dashed).toBeUndefined();
    expect(d.avatars[1]?.dashed).toBe(true);
  });
});

describe("routeLegs (D-29)", () => {
  const gym = { id: "p1", label: "Gym", icon: "gym" as const, address: "Fitness Park" };
  const shop = { id: "p2", label: "Shop", icon: "shop" as const, address: "Market St" };

  it("puts an outbound stop on the single line of a one-way out trip", () => {
    const d = decorateTrip({ ...base, direction: "out", outStop: gym });
    expect(d.route).toEqual({ from: "Riverside", to: "HQ", stop: gym });
    expect(d.returnRoute).toBeNull();
  });

  it("puts a return stop inline on a one-way back trip, with no second line", () => {
    // toTripView() has already swapped from/to for a 'back' trip, so its one line *is* the return
    // leg — drawing a second would read as two separate detours.
    const d = decorateTrip({ ...base, direction: "back", from: "HQ", to: "Riverside", backStop: gym });
    expect(d.route).toEqual({ from: "HQ", to: "Riverside", stop: gym });
    expect(d.returnRoute).toBeNull();
  });

  it("gives a round trip's return stop its own reversed line", () => {
    const d = decorateTrip({ ...base, direction: "round", backStop: gym });
    expect(d.route).toEqual({ from: "Riverside", to: "HQ", stop: null });
    expect(d.returnRoute).toEqual({ from: "HQ", to: "Riverside", stop: gym });
  });

  it("carries a stop on each leg of a round trip independently", () => {
    const d = decorateTrip({ ...base, direction: "round", outStop: gym, backStop: shop });
    expect(d.route.stop).toEqual(gym);
    expect(d.returnRoute?.stop).toEqual(shop);
  });

  it("draws no second line for a round trip that only stops on the way out", () => {
    const d = decorateTrip({ ...base, direction: "round", outStop: gym });
    expect(d.route.stop).toEqual(gym);
    expect(d.returnRoute).toBeNull();
  });

  it("leaves both lines unmarked when the trip has no stops", () => {
    const d = decorateTrip({ ...base, direction: "round" });
    expect(d.route.stop).toBeNull();
    expect(d.returnRoute).toBeNull();
  });

  it("ignores a back stop on an out-only trip", () => {
    const d = decorateTrip({ ...base, direction: "out", backStop: gym });
    expect(d.returnRoute).toBeNull();
    expect(d.route.stop).toBeNull();
  });
});
