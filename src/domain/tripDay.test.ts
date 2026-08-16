import { describe, expect, it } from "vitest";
import { dayLabel, formatTripTime, groupByDay } from "./tripDay";

const NOW = new Date("2026-08-17T12:00:00"); // a Monday, local time

describe("dayLabel", () => {
  it("labels the same calendar day as Today", () => {
    expect(dayLabel(new Date("2026-08-17T07:45:00"), NOW)).toBe("Today · Mon 17");
  });

  it("labels the next calendar day as Tomorrow", () => {
    expect(dayLabel(new Date("2026-08-18T07:45:00"), NOW)).toBe("Tomorrow · Tue 18");
  });

  it("labels further-out days with just weekday + day", () => {
    expect(dayLabel(new Date("2026-08-19T07:45:00"), NOW)).toBe("Wed 19");
  });

  it("ignores time-of-day when computing the day boundary", () => {
    expect(dayLabel(new Date("2026-08-17T23:59:00"), new Date("2026-08-17T00:01:00"))).toBe("Today · Mon 17");
  });
});

describe("formatTripTime", () => {
  it("formats morning times without a leading zero", () => {
    expect(formatTripTime(new Date("2026-08-17T07:45:00"))).toBe("7:45");
  });

  it("formats afternoon/evening times in 24h form", () => {
    expect(formatTripTime(new Date("2026-08-17T17:30:00"))).toBe("17:30");
  });

  it("pads single-digit minutes", () => {
    expect(formatTripTime(new Date("2026-08-17T08:05:00"))).toBe("8:05");
  });
});

describe("groupByDay", () => {
  it("groups by label in first-appearance order and sorts within each day", () => {
    const items = [
      { id: "a", label: "Today", time: "8:10" },
      { id: "b", label: "Today", time: "7:45" },
      { id: "c", label: "Tomorrow", time: "7:30" },
    ];
    const grouped = groupByDay(
      items,
      (i) => i.label,
      (a, b) => a.time.localeCompare(b.time),
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
