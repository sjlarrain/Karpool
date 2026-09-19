// D-61's one-time "what's new" sheet: which announcement is current.
//
// It lives here, and not beside the sheet, because the sheet is a client component: Next replaces a
// "use client" module with a client-reference proxy when a server component imports it, so a plain
// constant exported from there reads as `undefined` on the server. That is not theoretical — the
// sheet shipped that way for an hour and reappeared on every visit, because the server was comparing
// the stored key against `undefined` and always finding a difference.
//
// A later announcement is a new value here, not a new column: `profile.seen_announcement` holds the
// last key a person closed.
export const ANNOUNCEMENT_KEY = "2026-09-auto-lifecycle";
