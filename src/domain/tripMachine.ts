import type { TripStatus } from "./types";

// Pure state machine, no I/O. Legal transitions per 02_IMPLEMENTATION_PLAN.md §4 Phase 3:
// scheduled→started (driver only, not before T-2h, D-16), started→closed (driver only),
// scheduled→cancelled (driver only). Everything else is rejected with a typed error.

export const START_WINDOW_MINUTES = 120; // D-16: fixed T-2h window

export type TripTransitionEvent = "start" | "close" | "cancel";

export interface TripTransitionActor {
  profileId: string;
  // D-35 mechanic (i): close is no longer driver-only. A rider on the trip, or a group admin, may
  // close a ride the driver forgot to close — otherwise the return leg is never generated and
  // everyone who declared a return is stranded. Start and cancel stay driver-only: they are the
  // driver's own commitments, and nobody else can make them on their behalf.
  isRider?: boolean;
  isGroupAdmin?: boolean;
}

// D-35 answer (A). A "full" close is the driver's: it names who actually rode, so anyone left
// unconfirmed is marked no_show and charged D-19's penalty. A "restricted" close is anyone else's
// — it confirms every active rider and can mark nobody as a no-show, because deciding that a
// colleague did not show up is a judgement only the driver was there to make. Both pay the driver
// the normal award; a leg that was actually driven is paid for regardless of who tapped Close.
export type CloseMode = "full" | "restricted";

export interface TripTransitionSnapshot {
  status: TripStatus;
  driverId: string;
  departAt: string; // ISO 8601
}

export type TripTransitionErrorCode = "not_driver" | "not_permitted" | "wrong_status" | "too_early";

export interface TripTransitionSuccess {
  ok: true;
  nextStatus: TripStatus;
  // Only set for "close" — which of the two close forms the actor has earned.
  closeMode?: CloseMode;
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
  const isDriver = actor.profileId === trip.driverId;

  if (event === "close") {
    if (!isDriver && !actor.isRider && !actor.isGroupAdmin) {
      return { ok: false, error: "not_permitted" };
    }
  } else if (!isDriver) {
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

  if (event === "close") {
    return { ok: true, nextStatus: to, closeMode: isDriver ? "full" : "restricted" };
  }

  return { ok: true, nextStatus: to };
}
