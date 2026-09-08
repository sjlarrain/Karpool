import { NOT_STARTED_REASON } from "./constants";
import type { TripStopView, TripView } from "./types";

// Ported from the sketch's decorate() — a trip's role-derived presentation (badge, accent, seat
// math, avatar stack) is computed per viewer, never stored. Pure, no I/O.

export interface AvatarView {
  label: string;
  bg: string;
  fg: string;
  dashed?: boolean;
}

// D-29: what this ride does before it arrives. Not a warning — nothing is wrong with a ride that
// stops — just a mention, stated under the route rather than threaded through it so a rider reads
// it as something the car does rather than as a place name inside "A -> B".
export interface StopNotice {
  stop: TripStopView;
  leg: "out" | "back";
  // Kept to a word or two: the chip beside it already names the place, so this only has to say
  // which leg of the ride it falls on.
  when: string;
}

/**
 * Why a viewer who is not on this ride cannot take a seat, or null when they can.
 *
 * D-59 (developer, 2026-09-07: "It said that it was full when it wasn't"). `joinable` is one
 * boolean standing for four different situations, and the UI printed "This carpool is full." for
 * every one of them — so a rider looking at an EMPTY car that had simply already left was told the
 * car was full. The screen contradicted itself in two places at once: the badge read
 * "OPEN · 3 SEATS" beside a sentence saying there were none.
 *
 * Splitting the reason out is the fix, and it belongs here rather than in the JSX: the rule that
 * decides it is the rule that has to explain it, and it is unit-tested in one place.
 */
export type JoinBlock =
  // The ride is over — closed, or cancelled.
  | "over"
  // D-23: it has already left. The seats may well be empty; they are just no longer takeable by
  // anyone but the driver, who can still seat someone at the kerb.
  | "departed"
  // Genuinely full.
  | "full";

export interface DecoratedTrip extends TripView {
  badge: string;
  badgeColor: string;
  badgeBg: string;
  accent: string;
  avatars: AvatarView[];
  seatsLeft: number;
  seatStr: string;
  seatColor: string;
  joinable: boolean;
  // Null when `joinable` is true, and null as well for a viewer who is already the driver or a
  // rider — they are not being blocked from anything.
  joinBlock: JoinBlock | null;
  driverLabel: string;
  // D-29: every stop this ride makes, in travel order. Empty for a direct ride.
  stopNotices: StopNotice[];
  // D-27/D-53: belongs in the Carpools tab's (collapsed) Past section rather than the live feed.
  isPast: boolean;
}

const ROLE_STYLE: Record<
  TripView["role"],
  { badge: string; badgeColor: string; badgeBg: string; accent: string }
> = {
  driving: {
    badge: "YOU'RE DRIVING",
    badgeColor: "var(--purple)",
    badgeBg: "var(--purple-soft)",
    accent: "var(--purple)",
  },
  joined: {
    badge: "JOINED",
    badgeColor: "var(--teal-ink)",
    badgeBg: "var(--teal-soft)",
    accent: "var(--teal)",
  },
  open: {
    badge: "",
    badgeColor: "rgba(0,0,0,.5)",
    badgeBg: "var(--role-open-badge-bg)",
    accent: "var(--role-open-accent)",
  },
};

// A finished trip's status outranks the viewer's role: "YOU'RE DRIVING" on a trip that was
// cancelled two days ago is a lie about the present. D-23/D-27 — an expired trip (the scheduler
// ended one nobody started) reads as "PAST", never "CANCELLED", so it doesn't look like the driver
// called it off on the people who were counting on it.
const TERMINAL_STYLE: { badge: string; badgeColor: string; badgeBg: string; accent: string } = {
  badge: "",
  badgeColor: "rgba(0,0,0,.45)",
  badgeBg: "var(--chip)",
  accent: "rgba(0,0,0,.18)",
};

function terminalBadge(trip: TripView): string | null {
  if (trip.status === "closed") return "COMPLETED";
  if (trip.status !== "cancelled") return null;
  return trip.cancelledReason === NOT_STARTED_REASON ? "PAST · NEVER STARTED" : "CANCELLED";
}

// D-29. A stop belongs to a leg, and `direction` says which legs the ride actually travels — so a
// 'back' trip's only possible stop is its return one, and a round trip can warn about both. Order
// is travel order, so the notices read the way the ride happens.
export function stopNotices(trip: TripView): StopNotice[] {
  const notices: StopNotice[] = [];
  if (trip.direction !== "back" && trip.outStop) {
    notices.push({ stop: trip.outStop, leg: "out", when: "in way" });
  }
  if (trip.direction !== "out" && trip.backStop) {
    notices.push({ stop: trip.backStop, leg: "back", when: "back" });
  }
  return notices;
}
/**
 * The single reason to give the viewer, most fundamental first.
 *
 * The order is what makes the message honest rather than merely different. A ride that is over is
 * over whether or not it was full; one that has left is gone whether or not it was full. "Full" is
 * the last thing worth saying, because it is the only one of the three a rider might outlast —
 * someone could still drop out.
 */
function joinBlockFor(trip: TripView, seatsLeft: number): JoinBlock | null {
  if (trip.status !== "scheduled") return "over";
  if (trip.departed) return "departed";
  if (seatsLeft <= 0) return "full";
  return null;
}

export function decorateTrip(trip: TripView): DecoratedTrip {
  const finished = terminalBadge(trip);
  const style = finished ? TERMINAL_STYLE : ROLE_STYLE[trip.role];
  const filled = trip.riders.length;
  const seatsLeft = trip.capacity - filled;
  const badge =
    finished ??
    (trip.role === "open"
      ? seatsLeft > 0
        ? `OPEN · ${seatsLeft} SEAT${seatsLeft > 1 ? "S" : ""}`
        : "FULL"
      : style.badge);

  const avatars: AvatarView[] = trip.riders
    .slice(0, 3)
    .map((r) => ({ label: r.initials, bg: r.color, fg: "var(--surface)" }));
  for (let i = filled; i < trip.capacity && avatars.length < 4; i++) {
    avatars.push({ label: "+", bg: "rgba(0,0,0,.04)", fg: "rgba(0,0,0,.35)", dashed: true });
  }

  return {
    ...trip,
    badge,
    badgeColor: style.badgeColor,
    badgeBg: style.badgeBg,
    accent: style.accent,
    avatars,
    seatsLeft,
    seatStr: `${filled} / ${trip.capacity} seats`,
    seatColor: trip.role === "open" && seatsLeft > 0 ? "var(--green)" : "rgba(0,0,0,.45)",
    // D-23: a ride that has already left can't be taken, even though its driver may still start
    // and close it for another 24h.
    joinable: trip.role === "open" && seatsLeft > 0 && trip.status === "scheduled" && !trip.departed,
    joinBlock: trip.role === "open" ? joinBlockFor(trip, seatsLeft) : null,
    driverLabel: trip.role === "driving" ? "You’re driving" : `${trip.driver} is driving`,
    stopNotices: stopNotices(trip),
    // D-53: a card only stops being news once its status is terminal — closed or cancelled. A
    // scheduled trip whose departure has passed is still active (its driver has 24h per D-23 to
    // start it, close it, or add someone, and everyone else still needs to see it's happening), and
    // a started trip is obviously still live — neither belongs behind the collapsed Past toggle.
    isPast: finished !== null,
  };
}
