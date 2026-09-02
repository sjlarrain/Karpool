import { describe, expect, it } from "vitest";
import { parkingLinkHost, parkingUrlForLeg } from "./parking";

const links = { parkingUrlOut: "https://park.example.com/office", parkingUrlBack: "https://park.example.com/home" };

describe("parkingUrlForLeg (D-54)", () => {
  it("gives an outbound leg the outbound link", () => {
    expect(parkingUrlForLeg("out", links)).toBe("https://park.example.com/office");
  });

  it("gives a return leg the return link", () => {
    expect(parkingUrlForLeg("back", links)).toBe("https://park.example.com/home");
  });

  it("treats a round trip as the outbound it is currently driving", () => {
    // D-35: the return is its own row with direction 'back', so it collects the other link itself.
    expect(parkingUrlForLeg("round", links)).toBe("https://park.example.com/office");
  });

  it("shows nothing for a leg the group never filled in", () => {
    // Both columns are optional: a commute that only pays at one end is the normal case.
    expect(parkingUrlForLeg("back", { parkingUrlOut: links.parkingUrlOut, parkingUrlBack: null })).toBeNull();
    expect(parkingUrlForLeg("out", { parkingUrlOut: null, parkingUrlBack: null })).toBeNull();
  });
});

describe("parkingLinkHost", () => {
  it("names the destination so the driver sees where they're being sent", () => {
    expect(parkingLinkHost("https://parkopedia.com/pay/1234")).toBe("parkopedia.com");
  });

  it("renders an unparseable value as text rather than throwing", () => {
    expect(parkingLinkHost("not a url")).toBe("not a url");
  });
});
