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

export interface TripRiderView {
  name: string;
  initials: string;
  color: string;
  pickup?: string;
  stop?: number;
}

export interface TripView {
  id: string;
  dayLabel: string;
  time: string;
  from: string;
  to: string;
  role: ViewerRole;
  driver: string;
  capacity: number;
  returnTime: string | null;
  status: TripStatus;
  riders: TripRiderView[];
}
