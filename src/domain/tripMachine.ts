import type { TripStatus } from "./types";

// Pure state machine, no I/O.
//
// D-61 (2026-09-19) removed Start and Close. Nobody taps anything to begin or end a ride any more:
// the scheduler SETTLES a trip once its departure time has passed (scheduled → closed), and that
// one step is what pays the driver, counts the riders and materialises a round trip's return leg.
// The only human transition left is the driver calling a trip off before it leaves.
//
// `started` stays in TripStatus because historical rows carry it, but nothing moves a trip into it
// any more, and nothing moves a trip out of it either — the D-61 rollout cancelled the ones in
// flight.

export type TripTransitionEvent = "settle" | "cancel";

export interface TripTransitionActor {
  // Absent for the scheduler, which acts as nobody. An absent id can never match driverId, so it
  // fails closed on the driver-only transition.
  profileId?: string;
  // The scheduler. The only actor that may settle a trip: a settle decides who rode and moves
  // points, and D-61's answer is that the departure time decides that, not a person.
  isSystem?: boolean;
}

export interface TripTransitionSnapshot {
  status: TripStatus;
  driverId: string;
  departAt: string; // ISO 8601
}

export type TripTransitionErrorCode = "not_driver" | "not_permitted" | "wrong_status" | "too_early" | "departed";

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
  settle: { from: "scheduled", to: "closed" },
  cancel: { from: "scheduled", to: "cancelled" },
};

export function transition(
  trip: TripTransitionSnapshot,
  event: TripTransitionEvent,
  actor: TripTransitionActor,
  now: Date = new Date(),
): TripTransitionResult {
  if (event === "settle") {
    if (!actor.isSystem) return { ok: false, error: "not_permitted" };
  } else if (actor.profileId !== trip.driverId) {
    return { ok: false, error: "not_driver" };
  }

  const { from, to } = TRANSITIONS[event];
  if (trip.status !== from) {
    return { ok: false, error: "wrong_status" };
  }

  const departed = new Date(trip.departAt).getTime() <= now.getTime();
  // A settle before departure would pay for a ride that has not happened.
  if (event === "settle" && !departed) return { ok: false, error: "too_early" };
  // A ride that has left is a ride that happened — the driver fixes its list, they don't cancel it.
  if (event === "cancel" && departed) return { ok: false, error: "departed" };

  return { ok: true, nextStatus: to };
}
