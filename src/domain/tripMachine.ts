import type { TripStatus } from "./types";

// Pure state machine, no I/O. Legal transitions per 02_IMPLEMENTATION_PLAN.md §4 Phase 3:
// scheduled→started (driver only, not before T-2h, D-16), started→closed (driver only),
// scheduled→cancelled (driver only). Everything else is rejected with a typed error.

export const START_WINDOW_MINUTES = 120; // D-16: fixed T-2h window

export type TripTransitionEvent = "start" | "close" | "cancel";

export interface TripTransitionActor {
  profileId: string;
}

export interface TripTransitionSnapshot {
  status: TripStatus;
  driverId: string;
  departAt: string; // ISO 8601
}

export type TripTransitionErrorCode = "not_driver" | "wrong_status" | "too_early";

export interface TripTransitionSuccess {
  ok: true;
  nextStatus: TripStatus;
}

export interface TripTransitionFailure {
  ok: false;
  error: TripTransitionErrorCode;
}

export type TripTransitionResult = TripTransitionSuccess | TripTransitionFailure;

const TRANSITIONS: Record<TripTransitionEvent, { from: TripStatus; to: TripStatus }> = {
  start: { from: "scheduled", to: "started" },
  close: { from: "started", to: "closed" },
  cancel: { from: "scheduled", to: "cancelled" },
};

export function transition(
  trip: TripTransitionSnapshot,
  event: TripTransitionEvent,
  actor: TripTransitionActor,
  now: Date = new Date(),
): TripTransitionResult {
  if (actor.profileId !== trip.driverId) {
    return { ok: false, error: "not_driver" };
  }

  const { from, to } = TRANSITIONS[event];
  if (trip.status !== from) {
    return { ok: false, error: "wrong_status" };
  }

  if (event === "start") {
    const earliestStart = new Date(trip.departAt).getTime() - START_WINDOW_MINUTES * 60_000;
    if (now.getTime() < earliestStart) {
      return { ok: false, error: "too_early" };
    }
  }

  return { ok: true, nextStatus: to };
}
