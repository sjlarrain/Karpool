import { describe, expect, it } from "vitest";
import { rideShareMessage, rideShareUrl, type RideShareInput } from "./tripShare";

const base: RideShareInput = {
  dayLabel: "Tomorrow · Tue 18",
  time: "8:15 AM",
  from: "North Ridge",
  to: "HQ Campus",
  driver: "Alex Morgan",
  role: "open",
  seatsLeft: 2,
};

describe("rideShareUrl", () => {
  it("builds the link from the origin the sharer is actually on", () => {
    expect(rideShareUrl("https://carpool.app", "abc-123")).toBe("https://carpool.app/t/abc-123");
  });

  it("drops a trailing slash so the path never doubles up", () => {
    expect(rideShareUrl("https://carpool.app/", "abc-123")).toBe("https://carpool.app/t/abc-123");
  });
});

describe("rideShareMessage", () => {
  it("names the driver in the third person for a rider sharing someone else's ride", () => {
    expect(rideShareMessage(base)).toEqual({
      title: "Ride to HQ Campus · Tomorrow · Tue 18, 8:15 AM",
      text: "Alex Morgan is driving North Ridge → HQ Campus, Tomorrow · Tue 18 at 8:15 AM. 2 seats left.",
    });
  });

  it("speaks in the first person when the driver shares their own ride", () => {
    expect(rideShareMessage({ ...base, role: "driving" }).text).toBe(
      "I'm driving North Ridge → HQ Campus, Tomorrow · Tue 18 at 8:15 AM. 2 seats left.",
    );
  });

  it("singularises a lone remaining seat", () => {
    expect(rideShareMessage({ ...base, seatsLeft: 1 }).text).toMatch(/1 seat left\.$/);
  });

  it("says the car is full rather than offering zero seats", () => {
    expect(rideShareMessage({ ...base, seatsLeft: 0 }).text).toMatch(/The car is full\.$/);
  });

  it("never claims seats are left on a negative count", () => {
    expect(rideShareMessage({ ...base, seatsLeft: -1 }).text).toMatch(/The car is full\.$/);
  });
});
