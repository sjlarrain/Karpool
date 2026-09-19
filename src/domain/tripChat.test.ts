import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE_LENGTH,
  QUICK_MESSAGES,
  canPostToTrip,
  canReadTrip,
  groupMessages,
  messageNotice,
  normalizeMessageBody,
  type ChatMessage,
} from "./tripChat";

describe("normalizeMessageBody", () => {
  it("trims the message", () => {
    expect(normalizeMessageBody("  I'm here  ")).toBe("I'm here");
  });

  it("rejects a message that is only whitespace", () => {
    expect(normalizeMessageBody("   \n\t  ")).toBeNull();
  });

  it("rejects an empty message", () => {
    expect(normalizeMessageBody("")).toBeNull();
  });

  it("rejects a message past the column's own limit", () => {
    expect(normalizeMessageBody("x".repeat(MAX_MESSAGE_LENGTH))).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(normalizeMessageBody("x".repeat(MAX_MESSAGE_LENGTH + 1))).toBeNull();
  });

  // The length that matters is the one being stored, so the trim happens first.
  it("measures the trimmed length, not the typed one", () => {
    expect(normalizeMessageBody(`  ${"x".repeat(MAX_MESSAGE_LENGTH)}  `)).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  it("caps runs of blank lines without touching anything else someone typed", () => {
    expect(normalizeMessageBody("north gate\n\n\n\n\nnot the south one")).toBe("north gate\n\nnot the south one");
    expect(normalizeMessageBody("two   spaces   stay")).toBe("two   spaces   stay");
  });

  it("normalises CRLF, so a paste from a desktop client is not longer than it looks", () => {
    expect(normalizeMessageBody("a\r\nb")).toBe("a\nb");
  });

  it("accepts every quick message it offers", () => {
    for (const quick of QUICK_MESSAGES) {
      expect(normalizeMessageBody(quick)).toBe(quick);
    }
  });
});

describe("canReadTrip", () => {
  it("lets the driver read their own trip's thread", () => {
    expect(canReadTrip({ isDriver: true, seatState: null })).toBe(true);
  });

  it("lets anyone holding a seat read it", () => {
    expect(canReadTrip({ isDriver: false, seatState: "joined" })).toBe(true);
    expect(canReadTrip({ isDriver: false, seatState: "confirmed" })).toBe(true);
  });

  // The group-wide RLS policy is defence in depth; this is the real gate.
  it("shuts out a group member who is not on the ride", () => {
    expect(canReadTrip({ isDriver: false, seatState: null })).toBe(false);
  });

  it("shuts out someone who gave their seat up or didn't ride", () => {
    expect(canReadTrip({ isDriver: false, seatState: "left" })).toBe(false);
    expect(canReadTrip({ isDriver: false, seatState: "no_show" })).toBe(false);
  });
});

describe("canPostToTrip", () => {
  it("is open while the trip is scheduled", () => {
    expect(canPostToTrip({ status: "scheduled", correctable: false, isDriver: true, seatState: null })).toBe(true);
    expect(canPostToTrip({ status: "scheduled", correctable: false, isDriver: false, seatState: "joined" })).toBe(true);
  });

  // D-61: the trip settles as it departs, so the ride is under way just as it reads "closed".
  it("stays open on a settled trip until the end of its day", () => {
    expect(canPostToTrip({ status: "closed", correctable: true, isDriver: false, seatState: "confirmed" })).toBe(true);
  });

  // A confirmed seat still READS the thread once the day is over — that is the ride they took.
  it("closes to everyone once the day is over", () => {
    expect(canPostToTrip({ status: "closed", correctable: false, isDriver: true, seatState: null })).toBe(false);
    expect(canPostToTrip({ status: "closed", correctable: false, isDriver: false, seatState: "confirmed" })).toBe(false);
    expect(canReadTrip({ isDriver: false, seatState: "confirmed" })).toBe(true);
  });

  it("closes on a cancelled trip too", () => {
    expect(canPostToTrip({ status: "cancelled", correctable: true, isDriver: true, seatState: null })).toBe(false);
  });

  it("never lets a non-participant post to a live trip", () => {
    expect(canPostToTrip({ status: "closed", correctable: true, isDriver: false, seatState: null })).toBe(false);
    expect(canPostToTrip({ status: "scheduled", correctable: false, isDriver: false, seatState: "left" })).toBe(false);
  });
});

const BASE: Omit<ChatMessage, "id" | "body" | "createdAt"> = {
  authorId: "driver",
  authorName: "Ana",
  initials: "AN",
  color: "#7c5cff",
  mine: false,
};

function msg(id: string, authorId: string, body: string, createdAt: string): ChatMessage {
  return { ...BASE, id, authorId, authorName: authorId, body, createdAt };
}

describe("groupMessages", () => {
  it("returns nothing for an empty thread", () => {
    expect(groupMessages([])).toEqual([]);
  });

  it("collapses consecutive messages from one author into a single run", () => {
    const runs = groupMessages([
      msg("1", "ana", "I'm here", "2026-09-07T07:40:00Z"),
      msg("2", "ana", "north gate", "2026-09-07T07:40:30Z"),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.messages.map((m) => m.body)).toEqual(["I'm here", "north gate"]);
  });

  it("starts a new run when the author changes", () => {
    const runs = groupMessages([
      msg("1", "ana", "I'm here", "2026-09-07T07:40:00Z"),
      msg("2", "bo", "coming", "2026-09-07T07:40:10Z"),
      msg("3", "ana", "ok", "2026-09-07T07:40:20Z"),
    ]);
    expect(runs.map((r) => r.authorId)).toEqual(["ana", "bo", "ana"]);
  });

  // Same person, but half an hour later is a new thing being said — and the point of splitting is
  // that the new run carries its own timestamp.
  it("starts a new run after a long gap, even from the same author", () => {
    const runs = groupMessages([
      msg("1", "ana", "leaving now", "2026-09-07T07:10:00Z"),
      msg("2", "ana", "I'm here", "2026-09-07T07:40:00Z"),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.messages[0]!.body).toBe("I'm here");
  });

  it("keeps a run going right up to the five-minute boundary", () => {
    const runs = groupMessages([
      msg("1", "ana", "one", "2026-09-07T07:40:00Z"),
      msg("2", "ana", "two", "2026-09-07T07:45:00Z"),
    ]);
    expect(runs).toHaveLength(1);
  });

  it("carries the author's identity onto the run so the bubble can be drawn once", () => {
    const runs = groupMessages([{ ...msg("1", "ana", "hi", "2026-09-07T07:40:00Z"), mine: true, initials: "AN" }]);
    expect(runs[0]).toMatchObject({ authorId: "ana", initials: "AN", mine: true });
  });
});

describe("messageNotice", () => {
  // The whole value of "I'm here" is being readable without unlocking the phone.
  it("puts the message itself in the push body", () => {
    expect(messageNotice("Ana", "I'm here 👋")).toEqual({ title: "Ana · trip chat", body: "I'm here 👋" });
  });

  it("truncates a long message rather than filling the lock screen", () => {
    const notice = messageNotice("Ana", "x".repeat(200));
    expect(notice.body).toHaveLength(120);
    expect(notice.body.endsWith("…")).toBe(true);
  });

  it("falls back to a name rather than rendering an empty one", () => {
    expect(messageNotice("   ", "here").title).toBe("Someone · trip chat");
  });
});
