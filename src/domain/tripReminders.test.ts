import { describe, expect, it } from "vitest";
import { isDepartureReminderDue, isParkingReminderDue } from "./tripReminders";

describe("isDepartureReminderDue", () => {
  const NOW = new Date("2026-08-31T08:00:00.000Z");
  const LEAD = 15;
  const GRACE = 5;

  const due = (departAt: string) => isDepartureReminderDue(departAt, NOW, LEAD, GRACE);

  it("a trip leaving inside the lead time is due", () => {
    expect(due("2026-08-31T08:10:00.000Z")).toBe(true);
  });

  it("a trip leaving exactly at the lead boundary is due — the boundary belongs to the window", () => {
    expect(due("2026-08-31T08:15:00.000Z")).toBe(true);
  });

  it("a trip further out than the lead time is not due yet", () => {
    expect(due("2026-08-31T08:15:00.001Z")).toBe(false);
    expect(due("2026-08-31T09:00:00.000Z")).toBe(false);
  });

  it("a departure that slipped past between two ticks is still due inside the grace period", () => {
    // The regression this grace period exists for: the old query looked forward from `now` only, so
    // one missed 5-minute tick meant the reminder was never sent at all.
    expect(due("2026-08-31T07:57:00.000Z")).toBe(true);
    expect(due("2026-08-31T07:55:00.000Z")).toBe(true);
  });

  it("a departure older than the grace period is not resurrected", () => {
    expect(due("2026-08-31T07:54:59.999Z")).toBe(false);
    expect(due("2026-08-31T06:00:00.000Z")).toBe(false);
  });

  it("an unparseable departure is never due rather than always due", () => {
    expect(due("not a date")).toBe(false);
  });
});

// D-61: the driver's "pay for parking" push, 30 minutes after the leg departs.
describe("isParkingReminderDue", () => {
  const DEPART = "2026-09-18T15:00:00.000Z";
  const due = (now: string) => isParkingReminderDue(DEPART, new Date(now), 30, 60);

  it("is not due before 30 minutes have passed", () => {
    expect(due("2026-09-18T15:29:59.000Z")).toBe(false);
  });

  it("is due at 30 minutes and for the grace hour after", () => {
    expect(due("2026-09-18T15:30:00.000Z")).toBe(true);
    expect(due("2026-09-18T16:30:00.000Z")).toBe(true);
  });

  it("is not resurrected after the grace hour — a scheduler back from the dead stays quiet", () => {
    expect(due("2026-09-18T16:30:00.001Z")).toBe(false);
  });

  it("an unparseable departure is never due", () => {
    expect(isParkingReminderDue("not a date", new Date(), 30, 60)).toBe(false);
  });
});
