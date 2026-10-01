import { describe, expect, it } from "vitest";
import { matchRideAlert, rideAlertMessage, shouldAlertSeatOpened, type RideAlertPrefs } from "./rideAlerts";

const LA = "America/Los_Angeles";

// Mon 2026-10-05. 07:30 PDT = 14:30Z, 17:30 PDT = 00:30Z next day.
const MON_0730 = "2026-10-05T14:30:00.000Z";

function prefs(over: Partial<RideAlertPrefs> = {}): RideAlertPrefs {
  return {
    enabled: true,
    slackMinutes: 30,
    timeZone: LA,
    days: {
      mon: { out: "07:30", back: "17:30" },
      tue: { out: null, back: null },
      wed: { out: "08:00", back: null },
      thu: { out: null, back: null },
      fri: { out: null, back: null },
    },
    ...over,
  };
}

describe("matchRideAlert (D-64)", () => {
  it("matches a ride to work at their usual time", () => {
    expect(matchRideAlert(prefs(), { direction: "out", departAt: MON_0730, returnAt: null })).toEqual(["out"]);
  });

  it("matches inside the slack, both earlier and later — a 7:00 ride alerts someone who leaves at 7:30", () => {
    expect(matchRideAlert(prefs(), { direction: "out", departAt: "2026-10-05T14:00:00.000Z", returnAt: null })).toEqual(["out"]);
    expect(matchRideAlert(prefs(), { direction: "out", departAt: "2026-10-05T15:00:00.000Z", returnAt: null })).toEqual(["out"]);
  });

  it("does not match outside the slack", () => {
    expect(matchRideAlert(prefs(), { direction: "out", departAt: "2026-10-05T13:59:00.000Z", returnAt: null })).toEqual([]);
    expect(matchRideAlert(prefs({ slackMinutes: 15 }), { direction: "out", departAt: "2026-10-05T14:00:00.000Z", returnAt: null })).toEqual([]);
  });

  it("uses the slack they chose — an hour catches a 6:30 ride", () => {
    expect(matchRideAlert(prefs({ slackMinutes: 60 }), { direction: "out", departAt: "2026-10-05T13:30:00.000Z", returnAt: null })).toEqual(["out"]);
  });

  it("matches a ride home against the back-home time", () => {
    expect(matchRideAlert(prefs(), { direction: "back", departAt: "2026-10-06T00:30:00.000Z", returnAt: null })).toEqual(["back"]);
    // A ride home at 7:30 is not a ride to work at 7:30.
    expect(matchRideAlert(prefs(), { direction: "back", departAt: MON_0730, returnAt: null })).toEqual([]);
  });

  it("matches either leg of a round trip, or both", () => {
    const round = { direction: "round" as const, departAt: MON_0730, returnAt: "2026-10-06T00:30:00.000Z" };
    expect(matchRideAlert(prefs(), round)).toEqual(["out", "back"]);
    expect(matchRideAlert(prefs(), { ...round, returnAt: "2026-10-06T03:00:00.000Z" })).toEqual(["out"]);
    expect(matchRideAlert(prefs(), { ...round, departAt: "2026-10-05T18:00:00.000Z" })).toEqual(["back"]);
  });

  it("stays quiet on a day left blank", () => {
    // Tue 07:30 PDT
    expect(matchRideAlert(prefs(), { direction: "out", departAt: "2026-10-06T14:30:00.000Z", returnAt: null })).toEqual([]);
  });

  it("never alerts on a weekend — the settings are Monday to Friday", () => {
    // Sat 07:30 PDT
    expect(matchRideAlert(prefs(), { direction: "out", departAt: "2026-10-10T14:30:00.000Z", returnAt: null })).toEqual([]);
  });

  it("reads the day and time in THEIR zone, not UTC", () => {
    // Wed 08:00 PDT is 15:00Z on Wednesday; in UTC the same instant would be read as 15:00.
    expect(matchRideAlert(prefs(), { direction: "out", departAt: "2026-10-07T15:00:00.000Z", returnAt: null })).toEqual(["out"]);
    // Mon 17:30 PDT is already TUESDAY in UTC — still Monday for them.
    expect(matchRideAlert(prefs({ days: { ...prefs().days, mon: { out: null, back: "17:30" } } }), { direction: "back", departAt: "2026-10-06T00:30:00.000Z", returnAt: null })).toEqual(["back"]);
  });

  it("does not wrap the window across midnight into another day", () => {
    const late = prefs({ days: { ...prefs().days, mon: { out: null, back: "23:50" } } });
    // Tue 00:10 PDT is 20 min after Mon 23:50, but it is Tuesday, and Tuesday is blank.
    expect(matchRideAlert(late, { direction: "back", departAt: "2026-10-06T07:10:00.000Z", returnAt: null })).toEqual([]);
  });

  it("is silent when alerts are off", () => {
    expect(matchRideAlert(prefs({ enabled: false }), { direction: "out", departAt: MON_0730, returnAt: null })).toEqual([]);
  });
});

describe("rideAlertMessage (D-64)", () => {
  const base = {
    driverName: "Ana",
    originLabel: "Home",
    destLabel: "Office",
    seatsFree: 3,
    timeZone: LA,
  };

  it("names the driver, the way, the day and time, and the free seats", () => {
    expect(
      rideAlertMessage({ ...base, legs: ["out"], trip: { direction: "out", departAt: MON_0730, returnAt: null } }),
    ).toEqual({ title: "A ride at your usual time", body: "Ana is driving Home → Office on Mon at 7:30 — 3 seats free." });
  });

  it("describes a ride home the other way round", () => {
    expect(
      rideAlertMessage({ ...base, legs: ["back"], trip: { direction: "back", departAt: "2026-10-06T00:30:00.000Z", returnAt: null } })
        .body,
    ).toBe("Ana is driving Office → Home on Mon at 17:30 — 3 seats free.");
  });

  it("names only the leg that matched on a round trip, or both", () => {
    const trip = { direction: "round" as const, departAt: MON_0730, returnAt: "2026-10-06T00:30:00.000Z" };
    expect(rideAlertMessage({ ...base, legs: ["back"], trip }).body).toBe(
      "Ana is driving Office → Home on Mon at 17:30 — 3 seats free.",
    );
    expect(rideAlertMessage({ ...base, legs: ["out", "back"], trip }).body).toBe(
      "Ana is driving Home → Office on Mon at 7:30 and back at 17:30 — 3 seats free.",
    );
  });

  it("says 1 seat, not 1 seats", () => {
    expect(
      rideAlertMessage({ ...base, seatsFree: 1, legs: ["out"], trip: { direction: "out", departAt: MON_0730, returnAt: null } })
        .body,
    ).toBe("Ana is driving Home → Office on Mon at 7:30 — 1 seat free.");
  });
});

describe("shouldAlertSeatOpened (D-64)", () => {
  const now = new Date("2026-10-05T14:00:00.000Z");
  const open = { status: "scheduled", departAt: "2026-10-05T14:30:00.000Z", now, wasFull: true, seatsFree: 1 };

  it("alerts when a full ride, still ahead, gets a seat back", () => {
    expect(shouldAlertSeatOpened(open)).toBe(true);
  });

  it("stays quiet when the ride already had free seats — those people were told when it was published", () => {
    expect(shouldAlertSeatOpened({ ...open, wasFull: false })).toBe(false);
  });

  it("stays quiet when no seat is actually free afterwards", () => {
    expect(shouldAlertSeatOpened({ ...open, seatsFree: 0 })).toBe(false);
  });

  it("stays quiet once the ride has left, or is no longer on offer", () => {
    expect(shouldAlertSeatOpened({ ...open, departAt: "2026-10-05T13:59:00.000Z" })).toBe(false);
    expect(shouldAlertSeatOpened({ ...open, departAt: now.toISOString() })).toBe(false);
    expect(shouldAlertSeatOpened({ ...open, status: "closed" })).toBe(false);
    expect(shouldAlertSeatOpened({ ...open, status: "cancelled" })).toBe(false);
  });
});

describe("rideAlertMessage — a seat opened (D-64)", () => {
  const base = { driverName: "Ana", originLabel: "Home", destLabel: "Office", seatsFree: 1, timeZone: LA, kind: "seat" as const };

  it("says a seat opened rather than that a ride was published", () => {
    expect(
      rideAlertMessage({ ...base, legs: ["out"], trip: { direction: "out", departAt: MON_0730, returnAt: null } }),
    ).toEqual({
      title: "A seat opened at your usual time",
      body: "A seat just opened on Ana's Home → Office ride on Mon at 7:30 — 1 seat free.",
    });
  });

  it("still names only the leg that matched", () => {
    const trip = { direction: "round" as const, departAt: MON_0730, returnAt: "2026-10-06T00:30:00.000Z" };
    expect(rideAlertMessage({ ...base, legs: ["back"], trip }).body).toBe(
      "A seat just opened on Ana's Office → Home ride on Mon at 17:30 — 1 seat free.",
    );
  });
});
