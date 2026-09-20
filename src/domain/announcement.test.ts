import { describe, expect, it } from "vitest";
import { ANNOUNCEMENT_KEY, ANNOUNCEMENT_MAX_VIEWS, nextAnnouncementState, shouldShowAnnouncement } from "./announcement";

const KEY = ANNOUNCEMENT_KEY;

describe("shouldShowAnnouncement (D-61: shown twice, then not)", () => {
  it("shows a key nobody has seen yet", () => {
    expect(shouldShowAnnouncement({ seenKey: null, seenCount: 0 }, KEY)).toBe(true);
  });

  it("shows it again after one dismissal", () => {
    expect(shouldShowAnnouncement({ seenKey: KEY, seenCount: 1 }, KEY)).toBe(true);
  });

  it("stops after ANNOUNCEMENT_MAX_VIEWS dismissals", () => {
    expect(shouldShowAnnouncement({ seenKey: KEY, seenCount: ANNOUNCEMENT_MAX_VIEWS }, KEY)).toBe(false);
  });

  it("never shows more than the max even if the count somehow overshoots", () => {
    expect(shouldShowAnnouncement({ seenKey: KEY, seenCount: ANNOUNCEMENT_MAX_VIEWS + 5 }, KEY)).toBe(false);
  });

  it("a different key's count does not carry over — a new announcement always starts at zero views", () => {
    expect(shouldShowAnnouncement({ seenKey: "some-older-key", seenCount: ANNOUNCEMENT_MAX_VIEWS }, KEY)).toBe(true);
  });
});

describe("nextAnnouncementState", () => {
  it("starts a fresh key at one view", () => {
    expect(nextAnnouncementState({ seenKey: null, seenCount: 0 }, KEY)).toEqual({ seenKey: KEY, seenCount: 1 });
  });

  it("increments the same key", () => {
    expect(nextAnnouncementState({ seenKey: KEY, seenCount: 1 }, KEY)).toEqual({ seenKey: KEY, seenCount: 2 });
  });

  it("caps at the max rather than counting past it forever", () => {
    expect(nextAnnouncementState({ seenKey: KEY, seenCount: ANNOUNCEMENT_MAX_VIEWS }, KEY)).toEqual({
      seenKey: KEY,
      seenCount: ANNOUNCEMENT_MAX_VIEWS,
    });
  });

  it("resets an old key's count to one rather than continuing it", () => {
    expect(nextAnnouncementState({ seenKey: "old-key", seenCount: 9 }, KEY)).toEqual({ seenKey: KEY, seenCount: 1 });
  });
});

describe("round trip: shown exactly ANNOUNCEMENT_MAX_VIEWS times", () => {
  it("shows, dismiss, shows, dismiss, then stops", () => {
    let state = { seenKey: null as string | null, seenCount: 0 };
    let views = 0;
    for (let i = 0; i < 10; i++) {
      if (!shouldShowAnnouncement(state, KEY)) break;
      views += 1;
      state = nextAnnouncementState(state, KEY);
    }
    expect(views).toBe(ANNOUNCEMENT_MAX_VIEWS);
  });
});
