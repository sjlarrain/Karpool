import { describe, it, expect } from "vitest";
import { relativeTime } from "./relativeTime";

const NOW = new Date("2026-08-19T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

describe("relativeTime", () => {
  it("renders the sketch's vocabulary", () => {
    expect(relativeTime(ago(5 * SECOND), NOW)).toBe("now");
    expect(relativeTime(ago(2 * MINUTE), NOW)).toBe("2m");
    expect(relativeTime(ago(HOUR), NOW)).toBe("1h");
    expect(relativeTime(ago(3 * HOUR), NOW)).toBe("3h");
    expect(relativeTime(ago(DAY), NOW)).toBe("1d");
  });

  it("switches unit exactly at each boundary, not before", () => {
    expect(relativeTime(ago(MINUTE - 1), NOW)).toBe("now");
    expect(relativeTime(ago(MINUTE), NOW)).toBe("1m");
    expect(relativeTime(ago(HOUR - 1), NOW)).toBe("59m");
    expect(relativeTime(ago(HOUR), NOW)).toBe("1h");
    expect(relativeTime(ago(DAY - 1), NOW)).toBe("23h");
    expect(relativeTime(ago(DAY), NOW)).toBe("1d");
    expect(relativeTime(ago(WEEK - 1), NOW)).toBe("6d");
    expect(relativeTime(ago(WEEK), NOW)).toBe("1w");
  });

  it("falls back to a date once relative stamps stop being useful", () => {
    expect(relativeTime(ago(3 * WEEK), NOW)).toBe("3w");
    expect(relativeTime(ago(4 * WEEK), NOW)).toBe("22 Jul");
    expect(relativeTime("2026-01-04T09:00:00.000Z", NOW)).toBe("4 Jan");
  });

  it("clamps a future timestamp to now rather than rendering a negative age", () => {
    expect(relativeTime(new Date(NOW.getTime() + 5 * MINUTE).toISOString(), NOW)).toBe("now");
  });

  it("returns an empty string for an unparseable timestamp", () => {
    expect(relativeTime("not a date", NOW)).toBe("");
  });
});
