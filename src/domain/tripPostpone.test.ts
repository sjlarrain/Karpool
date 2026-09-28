import { describe, expect, it } from "vitest";
import { checkPostpone } from "./tripPostpone";

const LA = "America/Los_Angeles";
// Settled at 07:30 PDT on Mon 2026-09-28; the driver's day ends at 00:00 PDT (07:00Z) on the 29th.
const DEPART = "2026-09-28T14:30:00.000Z";
const NOW = new Date("2026-09-28T14:45:00.000Z"); // 07:45 PDT, fifteen minutes after it "left"
const trip = { status: "closed", departAt: DEPART, returnAt: null };

describe("checkPostpone (D-63)", () => {
  it("accepts a later time the same day", () => {
    expect(checkPostpone(trip, "2026-09-28T16:00:00.000Z", NOW, LA)).toEqual({ ok: true });
  });

  it("accepts the last minute of the day", () => {
    expect(checkPostpone(trip, "2026-09-29T06:59:00.000Z", NOW, LA)).toEqual({ ok: true });
  });

  it("refuses tomorrow — a postpone stays on the day the ride was for", () => {
    expect(checkPostpone(trip, "2026-09-29T07:00:00.000Z", NOW, LA)).toEqual({ ok: false, error: "other_day" });
  });

  it("refuses a time that has already passed", () => {
    expect(checkPostpone(trip, "2026-09-28T14:40:00.000Z", NOW, LA)).toEqual({ ok: false, error: "not_later" });
    expect(checkPostpone(trip, NOW.toISOString(), NOW, LA)).toEqual({ ok: false, error: "not_later" });
  });

  it("refuses a ride that has not settled — before departure it is an ordinary edit", () => {
    expect(checkPostpone({ ...trip, status: "scheduled" }, "2026-09-28T16:00:00.000Z", NOW, LA)).toEqual({
      ok: false,
      error: "not_settled",
    });
    expect(checkPostpone({ ...trip, status: "cancelled" }, "2026-09-28T16:00:00.000Z", NOW, LA)).toEqual({
      ok: false,
      error: "not_settled",
    });
  });

  it("refuses a ride from an earlier day — the window is the day it left", () => {
    const tomorrow = new Date("2026-09-29T15:00:00.000Z");
    expect(checkPostpone(trip, "2026-09-29T16:00:00.000Z", tomorrow, LA)).toEqual({
      ok: false,
      error: "window_closed",
    });
  });

  it("uses the driver's LOCAL day — 20:00 PDT is already tomorrow in UTC but still today for them", () => {
    expect(checkPostpone(trip, "2026-09-29T03:00:00.000Z", NOW, LA)).toEqual({ ok: true });
  });

  it("keeps a round trip's outbound before its return, which stays where it is", () => {
    const round = { ...trip, returnAt: "2026-09-29T00:30:00.000Z" }; // returns 17:30 PDT
    expect(checkPostpone(round, "2026-09-28T17:00:00.000Z", NOW, LA)).toEqual({ ok: true });
    expect(checkPostpone(round, "2026-09-29T00:30:00.000Z", NOW, LA)).toEqual({ ok: false, error: "after_return" });
    expect(checkPostpone(round, "2026-09-29T02:00:00.000Z", NOW, LA)).toEqual({ ok: false, error: "after_return" });
  });

  it("refuses an unreadable time", () => {
    expect(checkPostpone(trip, "not a time", NOW, LA)).toEqual({ ok: false, error: "not_later" });
  });
});
