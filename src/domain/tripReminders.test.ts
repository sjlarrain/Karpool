import { describe, expect, it } from "vitest";
import { isDepartureReminderDue, isCloseReminderDue } from "./tripReminders";

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

describe("isCloseReminderDue", () => {
  const NOW = new Date("2026-08-31T10:00:00.000Z");
  const AFTER = 90;

  it("a trip started longer ago than the threshold is due", () => {
    expect(isCloseReminderDue("2026-08-31T08:29:00.000Z", NOW, AFTER)).toBe(true);
  });

  it("the threshold itself counts as due", () => {
    expect(isCloseReminderDue("2026-08-31T08:30:00.000Z", NOW, AFTER)).toBe(true);
  });

  it("a trip started more recently than the threshold is left alone", () => {
    expect(isCloseReminderDue("2026-08-31T09:00:00.000Z", NOW, AFTER)).toBe(false);
  });

  it("a started row with no started_at is not due — a data fault must not spray notifications", () => {
    expect(isCloseReminderDue(null, NOW, AFTER)).toBe(false);
    expect(isCloseReminderDue("not a date", NOW, AFTER)).toBe(false);
  });
});
