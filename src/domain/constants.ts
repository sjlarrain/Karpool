// Ported verbatim from 02_IMPLEMENTATION_PLAN.md §3.3 — do not alter without a decision in
// docs/DECISIONS.md.
export const POINTS = { drive: 10, pool: 3, kudos: 2 } as const; // group-overridable (D-11)
export const LATE_LEAVE = { windowMinutes: 60, penalty: -5 } as const; // (D-10)
export const SEATS = { default: 3, min: 1, max: 7 } as const;
export const TRIP_STATUS = ["scheduled", "started", "closed", "cancelled"] as const;
export const GROUP_CODE_LENGTH = 6;

// D-23: a scheduled trip nobody started stays live for this long past its departure time — the
// driver can still start it, close it, or add passengers — and is then ended by the scheduler with
// this cancelled_reason, which the UI renders as "Past · not started" rather than "Cancelled".
export const UNSTARTED_GRACE_HOURS = 24;
export const NOT_STARTED_REASON = "not_started";

// D-35 mechanic (ii): how long before a round trip's return departure the scheduler gives up
// waiting for the driver and materialises the return leg itself. Deliberately the same 120 as
// D-16's start window, for the same reason — two hours out is the point where a rider needs to
// know whether they have a seat home, and where a driver can still act on the answer. The two
// numbers coincide but are not the same rule: changing one does not imply changing the other.
export const RETURN_LEG_LEAD_MINUTES = 120;

// D-27: how far back the Carpools tab's Past section reaches. Applied default, not a decision —
// all-time history is a bigger query and a bigger screen than was asked for.
export const PAST_TRIPS_WINDOW_DAYS = 30;
