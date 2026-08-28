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
  driverLabel: string;
  // D-29: every stop this ride makes, in travel order. Empty for a direct ride.
  stopNotices: StopNotice[];
  // D-27: belongs in the Carpools tab's Past section rather than the live feed.
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
    driverLabel: trip.role === "driving" ? "You’re driving" : `${trip.driver} is driving`,
    stopNotices: stopNotices(trip),
    isPast: finished !== null,
  };
}
