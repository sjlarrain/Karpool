import { describe, expect, it } from "vitest";
import { dayLabel, formatTripTime, groupByDay, zonedParts } from "./tripDay";

// Every case names the reader's zone explicitly and anchors its instants with an offset, so the
// results are identical whether this runs on a developer's laptop or in a UTC CI container — which
// is the whole point of the change these tests cover.
const LA = "America/Los_Angeles";
const NOW = new Date("2026-08-17T12:00:00-07:00"); // Monday noon in California

describe("formatTripTime", () => {
  it("formats morning times without a leading zero", () => {
    expect(formatTripTime(new Date("2026-08-17T07:45:00-07:00"), LA)).toBe("7:45");
  });

  it("formats afternoon/evening times in 24h form", () => {
    expect(formatTripTime(new Date("2026-08-17T17:30:00-07:00"), LA)).toBe("17:30");
  });

  it("pads single-digit minutes", () => {
    expect(formatTripTime(new Date("2026-08-17T08:05:00-07:00"), LA)).toBe("8:05");
  });

  it("renders midnight as 0:00, never 24:00", () => {
    expect(formatTripTime(new Date("2026-08-17T00:00:00-07:00"), LA)).toBe("0:00");
  });

  it("reads the same instant differently in different zones", () => {
    const instant = new Date("2026-08-17T14:45:00Z");
    expect(formatTripTime(instant, LA)).toBe("7:45");
    expect(formatTripTime(instant, "UTC")).toBe("14:45");
    expect(formatTripTime(instant, "Europe/Madrid")).toBe("16:45");
  });

  it("follows the zone's DST offset rather than a fixed one", () => {
    // Same wall-clock departure either side of the US DST change: -07:00 in August, -08:00 in
    // December. A hardcoded offset would render one of them an hour out.
    expect(formatTripTime(new Date("2026-08-17T14:45:00Z"), LA)).toBe("7:45");
    expect(formatTripTime(new Date("2026-12-17T15:45:00Z"), LA)).toBe("7:45");
  });
});

describe("dayLabel", () => {
  it("labels the same calendar day as Today", () => {
    expect(dayLabel(new Date("2026-08-17T07:45:00-07:00"), NOW, LA)).toBe("Today · Mon 17");
  });

  it("labels the next calendar day as Tomorrow", () => {
    expect(dayLabel(new Date("2026-08-18T07:45:00-07:00"), NOW, LA)).toBe("Tomorrow · Tue 18");
  });

  it("labels further-out days with just weekday + day", () => {
    expect(dayLabel(new Date("2026-08-19T07:45:00-07:00"), NOW, LA)).toBe("Wed 19");
  });

  it("ignores time-of-day when computing the day boundary", () => {
    expect(dayLabel(new Date("2026-08-17T23:59:00-07:00"), new Date("2026-08-17T00:01:00-07:00"), LA)).toBe(
      "Today · Mon 17",
    );
  });

  it("takes the day boundary from the reader's zone", () => {
    // 17:00 in California on Monday is already Tuesday 00:00 in UTC — the same instant belongs to
    // two different days, and the reader's zone decides which one the feed groups it under.
    const evening = new Date("2026-08-17T17:00:00-07:00");
    expect(dayLabel(evening, NOW, LA)).toBe("Today · Mon 17");
    expect(dayLabel(evening, NOW, "UTC")).toBe("Tomorrow · Tue 18");
  });
});

describe("zonedParts", () => {
  it("reads an instant's civil date and time in the given zone", () => {
    expect(zonedParts(new Date("2026-08-17T14:45:00Z"), LA)).toEqual({
      year: 2026,
      month: 8,
      day: 17,
      hour: 7,
      minute: 45,
      weekday: "Mon",
    });
  });
});

describe("groupByDay", () => {
  it("groups by label in first-appearance order and sorts within each day", () => {
    const items = [
      { id: "a", label: "Today", departAt: "2026-08-17T08:10:00-07:00" },
      { id: "b", label: "Today", departAt: "2026-08-17T07:45:00-07:00" },
      { id: "c", label: "Tomorrow", departAt: "2026-08-18T07:30:00-07:00" },
    ];
    const grouped = groupByDay(
      items,
      (i) => i.label,
      (a, b) => new Date(a.departAt).getTime() - new Date(b.departAt).getTime(),
    );
    expect(grouped).toEqual([
      { label: "Today", items: [items[1], items[0]] },
      { label: "Tomorrow", items: [items[2]] },
    ]);
  });

  it("returns an empty array for no items", () => {
    expect(groupByDay([], () => "x", () => 0)).toEqual([]);
  });
});
