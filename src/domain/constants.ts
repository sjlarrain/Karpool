// Ported verbatim from 02_IMPLEMENTATION_PLAN.md §3.3 — do not alter without a decision in
// docs/DECISIONS.md.
export const POINTS = { drive: 10, pool: 3, kudos: 2 } as const; // group-overridable (D-11)
export const LATE_LEAVE = { windowMinutes: 60, penalty: -5 } as const; // (D-10)
export const SEATS = { default: 3, min: 1, max: 7 } as const;
export const TRIP_STATUS = ["scheduled", "started", "closed", "cancelled"] as const;
export const GROUP_CODE_LENGTH = 6;
