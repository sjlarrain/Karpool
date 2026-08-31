import { avatarColorFor } from "./avatarColor";
import { initialsFor } from "./initials";
import { dayLabel, formatTripTime } from "./tripDay";
import { STOP_ICONS } from "./types";
import type { StopIcon, TripDirection, TripRiderView, TripStatus, TripStopView, ViewerRole } from "./types";
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

// A joined pickup_place row (D-29). `icon` arrives as a bare string from the generated DB types —
// the CHECK constraint guarantees the value, but the type system doesn't, so stopView() narrows it
// rather than casting.
export interface TripStopRowInput {
  id: string;
  label: string;
  icon: string | null;
  address: string;
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
  outStop?: TripStopRowInput | null;
  backStop?: TripStopRowInput | null;
}

export interface DriverInput {
  id: string;
  displayName: string;
}

function isStopIcon(value: string | null): value is StopIcon {
  return value !== null && (STOP_ICONS as readonly string[]).includes(value);
}

// A stop with no recognisable icon has no sign to show, so it is dropped rather than rendered as a
// blank marker — the sign is the whole point of the feature (D-29).
export function stopView(row: TripStopRowInput | null | undefined): TripStopView | null {
  if (!row || !isStopIcon(row.icon)) return null;
  return { id: row.id, label: row.label, icon: row.icon, address: row.address };
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
  // IANA zone the reader is in. Explicit because the server has no business rendering trip times
  // in its own zone (UTC on Vercel) — see src/domain/timeZone.ts.
  timeZone: string;
}): TripView {
  const { trip, driver, activeRiders, viewerId, originLabel, destLabel, now, timeZone } = params;

  const role = deriveRole(trip.driverId, activeRiders, viewerId);
  const back = trip.direction === "back";
  const from = back ? destLabel : originLabel;
  const to = back ? originLabel : destLabel;

  const departDate = new Date(trip.departAt);

  return {
    id: trip.id,
    departAt: trip.departAt,
    dayLabel: dayLabel(departDate, now, timeZone),
    time: formatTripTime(departDate, timeZone),
    from,
    to,
    direction: trip.direction,
    role,
    driver: trip.driverId === viewerId ? "You" : driver.displayName,
    capacity: trip.capacity,
    returnTime: trip.returnAt ? formatTripTime(new Date(trip.returnAt), timeZone) : null,
    status: trip.status,
    departed: departDate.getTime() <= now.getTime(),
    cancelledReason: trip.cancelledReason ?? null,
    // A leg the trip does not travel cannot carry a stop. The DB enforces this too (migration
    // 0012), but the mapper must not surface a stale value if a direction is ever edited.
    outStop: back ? null : stopView(trip.outStop),
    backStop: trip.direction === "out" ? null : stopView(trip.backStop),
    riders: activeRiders.map(riderView),
  };
}
