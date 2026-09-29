import { zonedParts } from "./tripDay";

// D-64 (developer, 2026-09-28) — "tell me when there's a ride at my usual time". Pure, no I/O.
//
// A person opts in (off by default), and for each WORKDAY sets the time they usually go to work
// and the time they usually go back home, either of which may be blank. They also choose how
// flexible they are: a 7:00 ride should reach someone whose usual time is 7:30. When a ride with
// free seats is PUBLISHED and either of its legs falls inside that window on that day, they get
// one notification. The same settings cover every group they belong to.

export const RIDE_ALERT_DAYS = ["mon", "tue", "wed", "thu", "fri"] as const;
export type RideAlertDay = (typeof RIDE_ALERT_DAYS)[number];

export const RIDE_ALERT_DAY_LABELS: Record<RideAlertDay, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
};

// "How flexible are you?" — the three choices on the settings screen.
export const RIDE_ALERT_SLACK_OPTIONS = [15, 30, 60] as const;
export type RideAlertSlack = (typeof RIDE_ALERT_SLACK_OPTIONS)[number];
export const DEFAULT_RIDE_ALERT_SLACK: RideAlertSlack = 30;

export type RideAlertLeg = "out" | "back";

export interface RideAlertDayTimes {
  out: string | null; // "HH:MM", when they usually go to work
  back: string | null; // "HH:MM", when they usually go back home
}

export interface RideAlertPrefs {
  enabled: boolean;
  slackMinutes: number;
  // The zone their times are written in, stamped when they save. "7:30" means 7:30 where they are.
  timeZone: string;
  days: Record<RideAlertDay, RideAlertDayTimes>;
}

export function emptyRideAlertDays(): Record<RideAlertDay, RideAlertDayTimes> {
  return { mon: blank(), tue: blank(), wed: blank(), thu: blank(), fri: blank() };
}
function blank(): RideAlertDayTimes {
  return { out: null, back: null };
}

const WEEKDAY_KEYS: Record<string, RideAlertDay> = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri" };

function minutesOf(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

// Does one departure instant fall inside the window for `leg` on its own day, read in their zone?
// The window never wraps past midnight: a ride at 00:10 is on the next day, whose times are its own.
function legMatches(prefs: RideAlertPrefs, leg: RideAlertLeg, at: string): boolean {
  const instant = new Date(at);
  if (Number.isNaN(instant.getTime())) return false;
  const parts = zonedParts(instant, prefs.timeZone);
  const day = WEEKDAY_KEYS[parts.weekday];
  if (!day) return false; // a weekend
  const usual = prefs.days[day]?.[leg];
  if (!usual) return false;
  const usualMinutes = minutesOf(usual);
  if (usualMinutes === null) return false;
  const rideMinutes = parts.hour * 60 + parts.minute;
  return Math.abs(rideMinutes - usualMinutes) <= prefs.slackMinutes;
}

/**
 * Which legs of a newly published ride fall inside this person's usual times — empty when none do.
 * A round trip is checked on both legs: its departure against the to-work time, its return against
 * the back-home time.
 */
export function matchRideAlert(
  prefs: RideAlertPrefs,
  trip: { direction: "out" | "back" | "round"; departAt: string; returnAt: string | null },
): RideAlertLeg[] {
  if (!prefs.enabled) return [];
  const legs: RideAlertLeg[] = [];
  if (trip.direction === "out" || trip.direction === "round") {
    if (legMatches(prefs, "out", trip.departAt)) legs.push("out");
  }
  if (trip.direction === "back" && legMatches(prefs, "back", trip.departAt)) legs.push("back");
  if (trip.direction === "round" && trip.returnAt && legMatches(prefs, "back", trip.returnAt)) legs.push("back");
  return legs;
}

/**
 * What the alert says, in the recipient's own zone. Only the leg(s) that matched are named — a
 * person who goes home at 17:30 is told about the 17:30 return, not the morning outbound.
 */
export function rideAlertMessage(input: {
  driverName: string;
  originLabel: string;
  destLabel: string;
  seatsFree: number;
  timeZone: string;
  legs: RideAlertLeg[];
  trip: { direction: "out" | "back" | "round"; departAt: string; returnAt: string | null };
}): { title: string; body: string } {
  const { trip, legs, timeZone } = input;
  const at = (iso: string) => {
    const p = zonedParts(new Date(iso), timeZone);
    return { day: p.weekday, time: `${p.hour}:${String(p.minute).padStart(2, "0")}` };
  };
  const outAt = trip.departAt;
  const backAt = trip.direction === "back" ? trip.departAt : trip.returnAt;
  const seats = `${input.seatsFree} seat${input.seatsFree === 1 ? "" : "s"} free`;
  const toWork = `${input.originLabel} → ${input.destLabel}`;
  const toHome = `${input.destLabel} → ${input.originLabel}`;

  let what: string;
  if (legs.includes("out") && legs.includes("back") && backAt) {
    const o = at(outAt);
    what = `${toWork} on ${o.day} at ${o.time} and back at ${at(backAt).time}`;
  } else if (legs.includes("back") && backAt) {
    const b = at(backAt);
    what = `${toHome} on ${b.day} at ${b.time}`;
  } else {
    const o = at(outAt);
    what = `${toWork} on ${o.day} at ${o.time}`;
  }
  return { title: "A ride at your usual time", body: `${input.driverName} is driving ${what} — ${seats}.` };
}
