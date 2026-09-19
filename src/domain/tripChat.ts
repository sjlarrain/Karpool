// D-57 — the per-trip thread's rules, pure and no I/O, so the API route, the UI and the tests share
// one definition of what a message is and who may write one (CLAUDE.md §3.5).
//
// The developer's examples — "I wait you here", "I am here" — are the whole design brief. This is a
// coordination channel attached to one ride, not a chat product: short messages, a live window, and
// nothing to configure.

import type { TripStatus } from "./types";

/** A coordination message, not a conversation. Mirrored by a CHECK on `trip_message.body`. */
export const MAX_MESSAGE_LENGTH = 500;

/**
 * The canned messages the sketch's own examples asked for, offered as one-tap chips so the common
 * case never involves typing while holding a steering wheel or standing in the rain.
 *
 * Ordered by who says them and when: the driver's two arrival messages first, then the rider's.
 * They are plain text and go through exactly the same validation and the same table as anything
 * typed by hand — a chip is a shortcut, not a second kind of message.
 */
export const QUICK_MESSAGES = [
  "I'm here 👋",
  "I'll wait for you here",
  "On my way",
  "Running 5 min late",
  "Two minutes away",
  "Can't make it, sorry",
] as const;

/**
 * Trim and reject in one step.
 *
 * Returns null for anything unusable, so a caller cannot accidentally store a blank message by
 * forgetting to check a boolean. Interior whitespace is left exactly as typed — collapsing it would
 * quietly rewrite what someone said — but runs of blank lines are capped, because a message pasted
 * with twenty of them makes the thread unreadable for everyone else.
 */
export function normalizeMessageBody(raw: string): string | null {
  const collapsed = raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  const body = collapsed.trim();
  if (body.length === 0) return null;
  if (body.length > MAX_MESSAGE_LENGTH) return null;
  return body;
}

/**
 * Who may write to a trip's thread: the driver, and anyone currently holding a seat.
 *
 * Deliberately narrower than "a member of the group". A thread is attached to one car on one
 * morning; a colleague who is not in it has no business posting to the people who are, and the
 * group tab is where group-wide things belong.
 *
 * A rider whose seat is `confirmed` still counts — that is the state a seat lands in when the trip
 * closes, so the people who actually rode keep their thread. A `left` or `no_show` seat does not:
 * they are not on this ride.
 */
export type SeatState = "joined" | "confirmed" | "left" | "no_show";

export function canPostToTrip(input: {
  status: TripStatus;
  // D-61: a settled trip whose departure day is not over yet (see tripSettle.canCorrect).
  correctable: boolean;
  isDriver: boolean;
  seatState: SeatState | null;
}): boolean {
  // D-61 settles a trip the moment it departs, so "closed" no longer means the ride is over — the
  // car has only just left. The thread stays open until the end of that day (the same window the
  // driver has to fix the ride list), then becomes readable history: nothing said after that could
  // help anyone catch the ride, and a thread on a dead trip is a place nobody is watching.
  const live = input.status === "scheduled" || (input.status === "closed" && input.correctable);
  if (!live) return false;
  return canReadTrip(input);
}

/** Who may read the thread. The same people, for the life of the trip. */
export function canReadTrip(input: { isDriver: boolean; seatState: SeatState | null }): boolean {
  if (input.isDriver) return true;
  return input.seatState === "joined" || input.seatState === "confirmed";
}

export interface ChatMessage {
  id: string;
  authorId: string;
  authorName: string;
  initials: string;
  color: string;
  body: string;
  createdAt: string; // ISO 8601
  mine: boolean;
}

export interface ChatRun {
  authorId: string;
  authorName: string;
  initials: string;
  color: string;
  mine: boolean;
  messages: { id: string; body: string; createdAt: string }[];
}

// Two messages from the same person within this long are one turn in the conversation and are drawn
// as one bubble group, with the name and avatar shown once.
const RUN_GAP_MS = 5 * 60_000;

/**
 * Collapse consecutive messages from one author into runs, so a driver sending three lines does not
 * get their avatar and name stamped three times.
 *
 * Input is expected oldest-first, which is the order the route returns and the order the thread is
 * read in. A gap longer than five minutes starts a new run even from the same author: the second
 * message is a new thing being said, not a continuation, and re-stamping the time is the point.
 */
export function groupMessages(messages: ChatMessage[]): ChatRun[] {
  const runs: ChatRun[] = [];

  for (const message of messages) {
    const last = runs[runs.length - 1];
    const previous = last?.messages[last.messages.length - 1];
    const continues =
      last !== undefined &&
      previous !== undefined &&
      last.authorId === message.authorId &&
      new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <= RUN_GAP_MS;

    if (continues) {
      last.messages.push({ id: message.id, body: message.body, createdAt: message.createdAt });
      continue;
    }

    runs.push({
      authorId: message.authorId,
      authorName: message.authorName,
      initials: message.initials,
      color: message.color,
      mine: message.mine,
      messages: [{ id: message.id, body: message.body, createdAt: message.createdAt }],
    });
  }

  return runs;
}

/**
 * The push a new message sends to everyone else on the trip.
 *
 * The body is the message itself, truncated — a notification that says "you have a new message" is
 * a notification that makes you open the app to find out it said "here". The whole value of "I'm
 * here" is being readable from the lock screen.
 */
export function messageNotice(authorName: string, body: string): { title: string; body: string } {
  const name = authorName.trim() || "Someone";
  const preview = body.length > 120 ? `${body.slice(0, 119).trimEnd()}…` : body;
  return { title: `${name} · trip chat`, body: preview };
}
