import { describe, expect, it } from "vitest";
import { seatChangeNotice } from "./seatNotice";

describe("seatChangeNotice (D-52)", () => {
  it("names the rider who took the seat", () => {
    const n = seatChangeNotice("join", "Ana Rivera");
    expect(n.type).toBe("join");
    expect(n.title).toBe("Someone joined your ride");
    expect(n.body).toBe("Ana Rivera grabbed a seat on your trip.");
  });

  it("tells the driver a dropped seat is available again, not just that it was lost", () => {
    const n = seatChangeNotice("leave", "Ana Rivera");
    expect(n.type).toBe("leave");
    expect(n.body).toBe("Ana Rivera left your trip — their seat is free again.");
  });

  it("falls back to a nameless phrasing rather than rendering an empty name", () => {
    // profile.display_name is not null, but a lookup can still come back empty-handed; "  grabbed
    // a seat" reads as a bug to the person receiving it.
    expect(seatChangeNotice("join", "").body).toBe("Someone grabbed a seat on your trip.");
    expect(seatChangeNotice("leave", "   ").body).toBe("Someone left your trip — their seat is free again.");
  });
});
