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

  it("pads avatars with dashed placeholders up to capacity, capped at 4", () => {
    const d = decorateTrip({ ...base, capacity: 6 });
    expect(d.avatars).toHaveLength(4);
    expect(d.avatars[0]?.dashed).toBeUndefined();
    expect(d.avatars[1]?.dashed).toBe(true);
  });
});
