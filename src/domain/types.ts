import type { TRIP_STATUS } from "./constants";

// Minimal types for Phase 0 (design tokens + component primitives). The full data model lives in
// the Phase 1 schema (02_IMPLEMENTATION_PLAN.md §4) — these are UI-facing shapes only, not DB rows.

export type TripStatus = (typeof TRIP_STATUS)[number];

export type TripDirection = "out" | "back" | "round";

// The viewer's relationship to a trip — always derived per viewer, never stored (§3.1 of the plan).
export type ViewerRole = "driving" | "joined" | "open";

// "reminder" (Phase 5, migration 0003) is distinct from "start" — "start" means the trip has
// actually started; "reminder" means it's departing soon. Not in the sketch's original mock list.
export type NotificationType = "start" | "rate" | "change" | "comment" | "tip" | "reminder";

// D-29: the sign a stop shows on the card. A fixed vocabulary, mirrored by the CHECK constraint in
// migration 0012 — free text would sprawl, and an emoji would render differently on each phone.
export const STOP_ICONS = ["gym", "pool", "run", "sport", "shop", "coffee", "school", "medical"] as const;
export type StopIcon = (typeof STOP_ICONS)[number];

// A place the whole car detours through mid-leg (D-29). Named and iconed by the group admin, so
// there is exactly one spelling of "Gym" in a group.
export interface TripStopView {
  id: string;
  label: string;
  icon: StopIcon;
  address: string;
}

export interface TripRiderView {
  name: string;
  initials: string;
  color: string;
  pickup?: string;
  stop?: number;
}

export interface TripView {
  id: string;
  // The absolute instant. `dayLabel`/`time` are renderings of it in the viewer's zone; anything
  // that needs to *compare* two trips (ordering, "has it left yet") uses this, never the strings —
  // "7:45" sorts after "17:30" as text.
  departAt: string; // ISO
  dayLabel: string;
  time: string;
  from: string;
  to: string;
  // D-29: needed to place a stop on the right leg — `from`/`to` are already swapped for a 'back'
  // trip, so they can't tell an outbound stop from a return one on their own.
  direction: TripDirection;
  role: ViewerRole;
  driver: string;
  capacity: number;
  returnTime: string | null;
  status: TripStatus;
  // D-23: past its departure time. Seats stop being self-servable here even while the driver can
  // still start the trip late.
  departed: boolean;
  // Set when the scheduler ended a trip nobody started (cancelled_reason 'not_started'), which the
  // UI must present as "Past", not as a driver cancelling on people.
  cancelledReason: string | null;
  // D-29: at most one stop per leg. Which line each one renders on is derived in decorateTrip().
  outStop: TripStopView | null;
  backStop: TripStopView | null;
  riders: TripRiderView[];
}
