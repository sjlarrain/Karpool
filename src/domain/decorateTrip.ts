import type { TripView } from "./types";

// Ported from the sketch's decorate() — a trip's role-derived presentation (badge, accent, seat
// math, avatar stack) is computed per viewer, never stored. Pure, no I/O.

export interface AvatarView {
  label: string;
  bg: string;
  fg: string;
  dashed?: boolean;
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

export function decorateTrip(trip: TripView): DecoratedTrip {
  const style = ROLE_STYLE[trip.role];
  const filled = trip.riders.length;
  const seatsLeft = trip.capacity - filled;
  const badge =
    trip.role === "open"
      ? seatsLeft > 0
        ? `OPEN · ${seatsLeft} SEAT${seatsLeft > 1 ? "S" : ""}`
        : "FULL"
      : style.badge;

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
    joinable: trip.role === "open" && seatsLeft > 0,
    driverLabel: trip.role === "driving" ? "You’re driving" : `${trip.driver} is driving`,
  };
}
