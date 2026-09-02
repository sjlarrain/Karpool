import { describe, expect, it } from "vitest";
import { claimantByGuestId, seatOwner, tallyPooledRides, tallyUnclaimedGuestRides } from "./guestRoster";

const claims = claimantByGuestId([
  { id: "g-maria", claimedByProfileId: "p-maria" },
  { id: "g-maria-g", claimedByProfileId: "p-maria" }, // two spellings, one colleague
  { id: "g-unknown", claimedByProfileId: null },
]);

describe("seatOwner (D-55)", () => {
  it("gives a real rider's seat to that rider", () => {
    expect(seatOwner({ profileId: "p-ana", groupGuestId: null }, claims)).toBe("p-ana");
  });

  it("gives a claimed guest's seat to the member they were linked to", () => {
    expect(seatOwner({ profileId: null, groupGuestId: "g-maria" }, claims)).toBe("p-maria");
  });

  it("gives an unclaimed guest's seat to nobody", () => {
    expect(seatOwner({ profileId: null, groupGuestId: "g-unknown" }, claims)).toBeNull();
  });

  it("gives a free-text close-time guest's seat to nobody, ever", () => {
    // D-09's name-only guest has no roster row to link, so this is the pre-D-55 behaviour intact.
    expect(seatOwner({ profileId: null, groupGuestId: null }, claims)).toBeNull();
  });

  it("gives a seat pointing at a guest the caller never loaded to nobody, not undefined", () => {
    expect(seatOwner({ profileId: null, groupGuestId: "g-missing" }, claims)).toBeNull();
  });
});

describe("tallyPooledRides (D-55)", () => {
  it("adds a claimed guest's history to the member's own rides", () => {
    // The whole point of the merge: two rides as "Maria" plus one since registering makes three,
    // and they appear the moment the link is made rather than counting only forward.
    const tally = tallyPooledRides(
      [
        { profileId: "p-maria", groupGuestId: null },
        { profileId: null, groupGuestId: "g-maria" },
        { profileId: null, groupGuestId: "g-maria" },
      ],
      claims,
    );
    expect(tally.get("p-maria")).toBe(3);
  });

  it("merges two roster spellings of the same person onto one member", () => {
    const tally = tallyPooledRides(
      [
        { profileId: null, groupGuestId: "g-maria" },
        { profileId: null, groupGuestId: "g-maria-g" },
      ],
      claims,
    );
    expect(tally.get("p-maria")).toBe(2);
  });

  it("counts nothing for an unclaimed guest or a free-text one", () => {
    const tally = tallyPooledRides(
      [
        { profileId: null, groupGuestId: "g-unknown" },
        { profileId: null, groupGuestId: null },
      ],
      claims,
    );
    expect(tally.size).toBe(0);
  });
});

describe("tallyUnclaimedGuestRides (D-55)", () => {
  it("counts the rides of a guest nobody has linked yet", () => {
    const tally = tallyUnclaimedGuestRides(
      [
        { profileId: null, groupGuestId: "g-unknown" },
        { profileId: null, groupGuestId: "g-unknown" },
      ],
      claims,
    );
    expect(tally.get("g-unknown")).toBe(2);
  });

  it("drops a guest once they are claimed, so one ride never shows twice on one screen", () => {
    const tally = tallyUnclaimedGuestRides([{ profileId: null, groupGuestId: "g-maria" }], claims);
    expect(tally.has("g-maria")).toBe(false);
  });

  it("ignores real riders and free-text guests", () => {
    const tally = tallyUnclaimedGuestRides(
      [
        { profileId: "p-ana", groupGuestId: null },
        { profileId: null, groupGuestId: null },
      ],
      claims,
    );
    expect(tally.size).toBe(0);
  });
});
