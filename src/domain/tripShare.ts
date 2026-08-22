import type { ViewerRole } from "./types";

// The message a rider or driver actually sends when they share a ride into WhatsApp. Pure — the
// caller supplies the already-formatted day/time (tripDay.ts) and the origin the sharer is on.
//
// What the *link* reveals is a separate question and is answered server-side (D-20): /t/:id shows
// nothing to anyone who isn't signed in and in the group. This text is composed on the sharer's own
// device from what they can already see, so it may name the driver and the seat count.

export interface RideShareInput {
  dayLabel: string;
  time: string;
  from: string;
  to: string;
  driver: string;
  role: ViewerRole;
  seatsLeft: number;
}

export function rideShareUrl(origin: string, tripId: string): string {
  return `${origin.replace(/\/+$/, "")}/t/${tripId}`;
}

export function rideShareMessage(trip: RideShareInput): { title: string; text: string } {
  const who = trip.role === "driving" ? "I'm driving" : `${trip.driver} is driving`;
  const seats =
    trip.seatsLeft <= 0 ? "The car is full." : `${trip.seatsLeft} seat${trip.seatsLeft === 1 ? "" : "s"} left.`;

  return {
    title: `Ride to ${trip.to} · ${trip.dayLabel}, ${trip.time}`,
    text: `${who} ${trip.from} → ${trip.to}, ${trip.dayLabel} at ${trip.time}. ${seats}`,
  };
}
