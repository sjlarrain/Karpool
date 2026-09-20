// D-61's "what's new" sheet: which announcement is current, and how many times a person is shown
// it. Pure decisions only, no I/O — the route and the server page both have to agree.
//
// ANNOUNCEMENT_KEY lives here, and not beside the sheet, because the sheet is a client component:
// Next replaces a "use client" module with a client-reference proxy when a server component imports
// it, so a plain constant exported from there reads as `undefined` on the server. That is not
// theoretical — the sheet shipped that way for an hour and reappeared on every visit, because the
// server was comparing the stored key against `undefined` and always finding a difference.
//
// A later announcement is a new value here, not a new column: `profile.seen_announcement` holds the
// last key a person closed, and `profile.announcement_seen_count` how many times they closed THAT
// key. A new key always starts back at zero views — nobody carries a used-up count into someone
// else's announcement.
export const ANNOUNCEMENT_KEY = "2026-09-auto-lifecycle";

// Developer, 2026-09-19: "it needs to appear twice." Once wasn't enough for a change this size to
// register with someone skimming past it.
export const ANNOUNCEMENT_MAX_VIEWS = 2;

export interface AnnouncementState {
  seenKey: string | null;
  seenCount: number;
}

/** Should this person still be shown `key` (defaulting to the current one)? */
export function shouldShowAnnouncement(state: AnnouncementState, key: string = ANNOUNCEMENT_KEY): boolean {
  // A different key (or none yet) means this key has never been shown to them — the old count, if
  // any, belonged to a different announcement and does not carry over.
  if (state.seenKey !== key) return true;
  return state.seenCount < ANNOUNCEMENT_MAX_VIEWS;
}

/** The state to write after this person closes the sheet for `key`. */
export function nextAnnouncementState(state: AnnouncementState, key: string = ANNOUNCEMENT_KEY): AnnouncementState {
  if (state.seenKey !== key) return { seenKey: key, seenCount: 1 };
  return { seenKey: key, seenCount: Math.min(state.seenCount + 1, ANNOUNCEMENT_MAX_VIEWS) };
}
