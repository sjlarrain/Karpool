// D-54: which parking link a trip shows. Pure — the leg a trip travels decides which end of the
// commute it parks at, and that is the same swap the route labels already make in toTripView.

import type { TripDirection } from "./types";

export interface GroupParkingLinks {
  parkingUrlOut: string | null;
  parkingUrlBack: string | null;
}

// A 'round' trip pre-close is driving the outbound — its return leg is a separate `trip` row
// (D-35) with direction 'back', so it picks up the return link on its own when it materialises.
export function parkingUrlForLeg(direction: TripDirection, links: GroupParkingLinks): string | null {
  return direction === "back" ? links.parkingUrlBack : links.parkingUrlOut;
}

// The label under the button, so a driver can see where a link goes before following it off the
// app. Falls back to the raw string rather than throwing: the column is https-constrained in the
// database, but a value that somehow got past that should still render as text, not crash a trip.
export function parkingLinkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
