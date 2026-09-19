import { canCorrect } from "@/domain/tripSettle";
import { viewerTimeZone } from "@/lib/time/viewerTimeZone";

// D-61: when may the driver change who is on a trip?
//
//   - while it is `scheduled` — before departure, and in the few minutes between departure and the
//     scheduler's settle (the settle then counts whatever the list says);
//   - once it is `closed`, until the end of the departure day in the DRIVER'S zone. The driver is
//     the one making the request, so the request's zone is theirs.
//
// Shared by every roster route so the window cannot mean two different things in two places.

export type RosterWindow =
  | { ok: true; settled: boolean }
  | { ok: false; error: "wrong_status" | "window_closed"; message: string };

export async function rosterWindow(trip: { status: string; depart_at: string }, now: Date = new Date()): Promise<RosterWindow> {
  if (trip.status === "scheduled") return { ok: true, settled: false };
  if (trip.status !== "closed") {
    return { ok: false, error: "wrong_status", message: "This trip is no longer active." };
  }
  if (!canCorrect({ status: trip.status, departAt: trip.depart_at }, now, await viewerTimeZone())) {
    return {
      ok: false,
      error: "window_closed",
      message: "This ride's list could only be changed until the end of the day it left.",
    };
  }
  return { ok: true, settled: true };
}
