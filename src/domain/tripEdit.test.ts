import { describe, expect, it } from "vitest";
import { diffTripEdit, type TripEditState } from "./tripEdit";

const CURRENT: TripEditState = {
  departAt: "2026-09-01T07:45:00+00:00",
  returnAt: "2026-09-01T17:30:00+00:00",
  capacity: 3,
  outStopId: null,
  backStopId: null,
};

describe("diffTripEdit", () => {
  it("reports nothing changed for an empty patch", () => {
    const diff = diffTripEdit(CURRENT, {});
    expect(diff.changed).toEqual([]);
    expect(diff.material).toBe(false);
    expect(diff.notice).toBeNull();
  });

  it("treats a patch that resends the current values as no change", () => {
    const diff = diffTripEdit(CURRENT, { departAt: CURRENT.departAt, capacity: 3, outStopId: null });
    expect(diff.changed).toEqual([]);
    expect(diff.material).toBe(false);
  });

  // The client sends "…Z"; Postgres hands back "…+00:00". The same instant spelled two ways must
  // not read as an edit, or every save would notify the riders and hand out a free drop-out.
  it("compares departure times as instants, not strings", () => {
    const diff = diffTripEdit(CURRENT, { departAt: "2026-09-01T07:45:00Z" });
    expect(diff.changed).toEqual([]);
  });

  it("flags a moved departure as material", () => {
    const diff = diffTripEdit(CURRENT, { departAt: "2026-09-01T08:15:00Z" });
    expect(diff.changed).toEqual(["departAt"]);
    expect(diff.material).toBe(true);
    expect(diff.notice?.title).toBe("Departure changed");
    expect(diff.notice?.body).toContain("no points lost");
  });

  it("flags a moved return as material", () => {
    const diff = diffTripEdit(CURRENT, { returnAt: "2026-09-01T18:00:00Z" });
    expect(diff.changed).toEqual(["returnAt"]);
    expect(diff.material).toBe(true);
  });

  it("flags a cleared return as material", () => {
    const diff = diffTripEdit(CURRENT, { returnAt: null });
    expect(diff.changed).toEqual(["returnAt"]);
    expect(diff.material).toBe(true);
  });

  it("flags an added stop as material and words it as a route change", () => {
    const diff = diffTripEdit(CURRENT, { outStopId: "8b1d0c2e-0000-4000-8000-000000000001" });
    expect(diff.changed).toEqual(["outStopId"]);
    expect(diff.material).toBe(true);
    expect(diff.notice?.title).toBe("Route changed");
  });

  it("flags a cleared stop as material", () => {
    const withStop = { ...CURRENT, backStopId: "8b1d0c2e-0000-4000-8000-000000000002" };
    const diff = diffTripEdit(withStop, { backStopId: null });
    expect(diff.changed).toEqual(["backStopId"]);
    expect(diff.material).toBe(true);
  });

  // A rider already in the car is unaffected by a seat the driver adds or takes back, so this
  // is recorded as a change but never notified and never waives the late-cancellation charge.
  it("records a capacity change without treating it as material", () => {
    const diff = diffTripEdit(CURRENT, { capacity: 4 });
    expect(diff.changed).toEqual(["capacity"]);
    expect(diff.material).toBe(false);
    expect(diff.notice).toBeNull();
  });

  it("merges time and stop wording when both moved", () => {
    const diff = diffTripEdit(CURRENT, {
      departAt: "2026-09-01T08:15:00Z",
      outStopId: "8b1d0c2e-0000-4000-8000-000000000001",
    });
    expect(diff.changed).toEqual(["departAt", "outStopId"]);
    expect(diff.notice?.title).toBe("Trip updated");
    expect(diff.notice?.body).toContain("time and where it stops");
  });

  it("notifies when a capacity change rides along with a material one", () => {
    const diff = diffTripEdit(CURRENT, { capacity: 5, departAt: "2026-09-01T08:15:00Z" });
    expect(diff.changed).toEqual(["departAt", "capacity"]);
    expect(diff.material).toBe(true);
  });
});
