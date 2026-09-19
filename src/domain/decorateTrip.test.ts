import { describe, expect, it } from "vitest";
import { decorateTrip } from "./decorateTrip";
import type { TripView } from "./types";

const base: TripView = {
  id: "t1",
  departAt: "2026-05-18T07:45:00-07:00",
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
  correctable: false,
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

  // ─── D-59: WHY a join is blocked, not just THAT it is ─────────────────────
  //
  // The developer, 2026-09-07, looking at an empty car: "It said that it was full when it wasn't.
  // I had to add it my self." `joinable` collapsed four situations into one boolean and the screen
  // printed "This carpool is full." for all of them, so the badge said OPEN · 3 SEATS beside a
  // sentence saying there were none.

  it("blocks nothing on an open trip with seats left", () => {
    expect(decorateTrip(base).joinBlock).toBeNull();
  });

  // The exact case from the developer's screenshot: three seats free, nobody aboard, and the ride
  // had simply already left. It must NOT say "full".
  it("says a departed trip has left, not that it is full", () => {
    const empty: TripView = { ...base, capacity: 3, riders: [], departed: true };
    const d = decorateTrip(empty);
    expect(d.seatsLeft).toBe(3);
    expect(d.badge).toBe("OPEN · 3 SEATS");
    expect(d.joinable).toBe(false);
    expect(d.joinBlock).toBe("departed");
  });

  it("still says full when the car really is full", () => {
    const full: TripView = {
      ...base,
      capacity: 1,
      riders: [{ name: "Marco Lee", initials: "ML", color: "#0ea5b0" }],
    };
    expect(decorateTrip(full).joinBlock).toBe("full");
  });

  // "Over" outranks both: a closed ride is closed whether or not it was full, and whether or not
  // its departure has passed. "Full" is last because it is the only one a rider might outlast.
  it("reports a finished trip as over, ahead of departed or full", () => {
    expect(decorateTrip({ ...base, status: "closed" }).joinBlock).toBe("over");
    expect(decorateTrip({ ...base, status: "cancelled" }).joinBlock).toBe("over");
    expect(decorateTrip({ ...base, status: "closed", departed: true, capacity: 1 }).joinBlock).toBe("over");
  });

  it("prefers 'departed' over 'full' on a trip that is both", () => {
    const full: TripView = {
      ...base,
      capacity: 1,
      riders: [{ name: "Marco Lee", initials: "ML", color: "#0ea5b0" }],
      departed: true,
    };
    expect(decorateTrip(full).joinBlock).toBe("departed");
  });

  // Nobody is being kept out of a ride they are already on, so there is no reason to show one.
  it("reports no reason at all for a viewer who is the driver or a rider", () => {
    expect(decorateTrip({ ...base, role: "driving", departed: true }).joinBlock).toBeNull();
    expect(decorateTrip({ ...base, role: "joined", status: "closed" }).joinBlock).toBeNull();
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

  it("stops a departed trip being joinable", () => {
    const d = decorateTrip({ ...base, departed: true, role: "open" });
    expect(d.joinable).toBe(false);
    expect(d.isPast).toBe(false);
  });

  it("keeps a departed trip the scheduler has not settled yet on the live feed for every viewer", () => {
    const departed = { ...base, departed: true } as const;
    expect(decorateTrip({ ...departed, role: "open" }).isPast).toBe(false);
    expect(decorateTrip({ ...departed, role: "joined" }).isPast).toBe(false);
    expect(decorateTrip({ ...departed, role: "driving" }).isPast).toBe(false);
  });

  it("keeps a settled trip on the live feed until its day is over (D-61)", () => {
    const today = decorateTrip({ ...base, status: "closed", departed: true, correctable: true });
    expect(today.badge).toBe("COMPLETED");
    expect(today.isPast).toBe(false);
    expect(decorateTrip({ ...base, status: "closed", departed: true, correctable: false }).isPast).toBe(true);
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
    expect(decorateTrip({ ...base, status: "cancelled", cancelledReason: "lifecycle_rollout" }).badge).toBe(
      "PAST · NOT COUNTED",
    );
  });

  it("pads avatars with dashed placeholders up to capacity, capped at 4", () => {
    const d = decorateTrip({ ...base, capacity: 6 });
    expect(d.avatars).toHaveLength(4);
    expect(d.avatars[0]?.dashed).toBeUndefined();
    expect(d.avatars[1]?.dashed).toBe(true);
  });
});

describe("stopNotices (D-29)", () => {
  const gym = { id: "p1", label: "Gym", icon: "gym" as const, address: "Fitness Park" };
  const shop = { id: "p2", label: "Shop", icon: "shop" as const, address: "Market St" };

  it("marks an outbound stop as the outbound leg", () => {
    const d = decorateTrip({ ...base, direction: "out", outStop: gym });
    expect(d.stopNotices).toEqual([{ stop: gym, leg: "out", when: "in way" }]);
  });

  it("marks a return stop as the return leg", () => {
    const d = decorateTrip({ ...base, direction: "back", from: "HQ", to: "Riverside", backStop: gym });
    expect(d.stopNotices).toEqual([{ stop: gym, leg: "back", when: "back" }]);
  });

  it("uses the same wording on a round trip's outbound leg as on a one-way", () => {
    // The leg determines the phrasing, not whether the ride comes back — a stop before arriving is
    // the same fact either way.
    const d = decorateTrip({ ...base, direction: "round", outStop: gym });
    expect(d.stopNotices).toEqual([{ stop: gym, leg: "out", when: "in way" }]);
  });

  it("lists both stops of a round trip in travel order", () => {
    const d = decorateTrip({ ...base, direction: "round", outStop: gym, backStop: shop });
    expect(d.stopNotices.map((n) => n.leg)).toEqual(["out", "back"]);
    expect(d.stopNotices[1]).toEqual({ stop: shop, leg: "back", when: "back" });
  });

  it("says nothing for a direct ride", () => {
    expect(decorateTrip({ ...base, direction: "round" }).stopNotices).toEqual([]);
  });

  it("ignores a stop on a leg the trip never travels", () => {
    // The DB blocks this combination too, but a stale value must not become a false warning.
    expect(decorateTrip({ ...base, direction: "out", backStop: gym }).stopNotices).toEqual([]);
    expect(decorateTrip({ ...base, direction: "back", outStop: gym }).stopNotices).toEqual([]);
  });
});
