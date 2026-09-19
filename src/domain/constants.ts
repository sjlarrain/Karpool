// Ported verbatim from 02_IMPLEMENTATION_PLAN.md §3.3 — do not alter without a decision in
// docs/DECISIONS.md.
export const POINTS = { drive: 10, pool: 3, kudos: 2 } as const; // group-overridable (D-11)
export const LATE_LEAVE = { windowMinutes: 60, penalty: -5 } as const; // (D-10)
export const SEATS = { default: 3, min: 1, max: 7 } as const;
export const TRIP_STATUS = ["scheduled", "started", "closed", "cancelled"] as const;
export const GROUP_CODE_LENGTH = 6;

// Historical cancelled_reason sentinels, both written by the system, never by a driver.
// D-23's scheduler expired trips nobody started (retired by D-61, but its rows remain). D-61's
// rollout cancelled every trip still unfinished past its departure on switch-over day.
export const NOT_STARTED_REASON = "not_started";
export const ROLLOUT_REASON = "lifecycle_rollout";
export const SYSTEM_CANCEL_REASONS: readonly string[] = [NOT_STARTED_REASON, ROLLOUT_REASON];

// D-27: how far back the Carpools tab's Past section reaches. Applied default, not a decision —
// all-time history is a bigger query and a bigger screen than was asked for.
export const PAST_TRIPS_WINDOW_DAYS = 30;

// --- Scheduler reminder windows (see src/domain/tripReminders.ts) ---

// How long before departure the "trip leaves soon" reminder goes out.
export const DEPARTURE_REMINDER_LEAD_MINUTES = 15;

// How late a departure reminder may still be sent. The scheduler ticks every 5 minutes, so a single
// missed tick used to drop the reminder for good: the query only looked forward from `now`, and a
// trip whose departure had slipped past was never eligible again. A reminder that arrives four
// minutes late is still worth having; one that arrives after the trip left is not, which is what
// bounds this.
export const DEPARTURE_REMINDER_GRACE_MINUTES = 5;

// D-61 (developer, 2026-09-19): 30 minutes after a leg departs, its driver is reminded to pay for
// parking — only on a leg whose group has a parking link for that direction (D-54).
export const PARKING_REMINDER_AFTER_MINUTES = 30;
export const PARKING_REMINDER_GRACE_MINUTES = 60;
