import { avatarColorFor } from "./avatarColor";
import { initialsFor } from "./initials";
import { dayLabel, formatTripTime } from "./tripDay";
import type { TripDirection, TripRiderView, TripStatus, ViewerRole } from "./types";
import type { TripView } from "./types";

// Maps raw DB rows (trip + its active trip_rider rows + driver profile + group route labels) to
// the UI-facing TripView the styleguide's decorateTrip() already knows how to render. Pure, no I/O
// — the caller has already fetched everything and passes "now" explicitly.

export interface TripRiderRowInput {
  profileId: string | null;
  guestName: string | null;
  displayName: string | null; // profile.display_name, only present when profileId is set
  initials: string | null; // profile.initials, only present when profileId is set
  avatarColor: string | null; // profile.avatar_color, only present when profileId is set
}

export interface TripRowInput {
  id: string;
  direction: TripDirection;
  departAt: string; // ISO
  returnAt: string | null;
  capacity: number;
  status: TripStatus;
  driverId: string;
  cancelledReason?: string | null;
}

export interface DriverInput {
  id: string;
  displayName: string;
}

export function riderView(rider: TripRiderRowInput): TripRiderView {
  if (rider.profileId) {
    return {
      name: rider.displayName ?? "Member",
      initials: rider.initials ?? "?",
      color: rider.avatarColor ?? avatarColorFor(rider.profileId),
    };
  }
  const name = rider.guestName ?? "Guest";
  return { name, initials: initialsFor(name), color: avatarColorFor(name) };
}

export function deriveRole(driverId: string, riders: TripRiderRowInput[], viewerId: string): ViewerRole {
  if (driverId === viewerId) return "driving";
  if (riders.some((r) => r.profileId === viewerId)) return "joined";
  return "open";
}

export function toTripView(params: {
  trip: TripRowInput;
  driver: DriverInput;
  activeRiders: TripRiderRowInput[]; // only rows with state 'joined' or 'confirmed'
  viewerId: string;
  originLabel: string;
  destLabel: string;
  now: Date;
}): TripView {
  const { trip, driver, activeRiders, viewerId, originLabel, destLabel, now } = params;

  const role = deriveRole(trip.driverId, activeRiders, viewerId);
  const back = trip.direction === "back";
  const from = back ? destLabel : originLabel;
  const to = back ? originLabel : destLabel;

  const departDate = new Date(trip.departAt);

  return {
    id: trip.id,
    dayLabel: dayLabel(departDate, now),
    time: formatTripTime(departDate),
    from,
    to,
    role,
    driver: trip.driverId === viewerId ? "You" : driver.displayName,
    capacity: trip.capacity,
    returnTime: trip.returnAt ? formatTripTime(new Date(trip.returnAt)) : null,
    status: trip.status,
    departed: departDate.getTime() <= now.getTime(),
    cancelledReason: trip.cancelledReason ?? null,
    riders: activeRiders.map(riderView),
  };
}
