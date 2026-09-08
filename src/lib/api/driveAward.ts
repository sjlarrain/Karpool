import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { computeDriveAward, computeDriveCorrection, type CloseWeights, type LedgerAward } from "@/domain/points";

// D-56 — the driver's award, written when they press Start and kept honest afterwards.
//
// The developer, 2026-09-07: "I want to make points after they press start." Until now the close
// was the only writer of points_ledger, and drivers were not closing, so rides that ran with a full
// car paid nothing at all.
//
// Start is a forecast. Seats change afterwards — someone climbs in at the kerb, a rider leaves, the
// driver names a no-show at close — and the developer asked the award to follow ("Yes, correct
// them"). It does, by APPENDING the difference: points_ledger is append-only (CLAUDE.md §3.5), so
// nothing here ever edits or deletes the row Start wrote.
//
// Every correction is derived from what the ledger already holds rather than from the change that
// triggered it, which is the property that makes this safe to call from six routes and a scheduler
// that can all fire at once: a correction lost to a failure is simply re-derived by the next one,
// and one applied twice owes nothing the second time.

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export interface DriveAwardResult {
  // The row written, or null when the driver already held exactly what they were owed.
  written: LedgerAward | null;
  // The driver's whole award for this trip once `written` has landed.
  total: number;
  // Set when the correction could not be written. NOT thrown and NOT swallowed: the roster change
  // that triggered it has already succeeded, so failing the caller's request would be a lie, but a
  // silent miss would be a leaderboard that quietly drifts (the D-41 failure, by another route).
  // The routes echo this back, and the next correction — or the close — re-derives it anyway.
  error?: string;
}

/** Everything already paid to this driver for this trip: the `drive` row plus every correction. */
export async function driveAwardPaid(admin: AdminClient, tripId: string, driverId: string): Promise<number | null> {
  const { data, error } = await admin
    .from("points_ledger")
    .select("points")
    .eq("trip_id", tripId)
    .eq("profile_id", driverId)
    .in("kind", ["drive", "drive_adjust"]);
  if (error) return null;
  return (data ?? []).reduce((sum, row) => sum + row.points, 0);
}

/**
 * Re-price a started trip against its current roster and append the difference.
 *
 * A no-op for any trip that is not `started`: a scheduled trip has not been paid yet, and a closed
 * or cancelled one is history. That guard is why the roster routes can call this unconditionally.
 */
export async function syncDriveAward(admin: AdminClient, tripId: string): Promise<DriveAwardResult> {
  const { data: trip, error } = await admin
    .from("trip")
    .select("id, driver_id, group_id, status")
    .eq("id", tripId)
    .maybeSingle();
  if (error) return { written: null, total: 0, error: error.message };
  if (!trip) return { written: null, total: 0, error: "trip_not_found" };
  if (trip.status !== "started") return { written: null, total: 0 };
  return settleDriveAward(admin, trip);
}

/**
 * The one write. Counts the seats, reads what has been paid, appends the difference.
 *
 * Called directly by `startTrip` for the first payment, where the trip has only just flipped to
 * `started` and there is nothing on the ledger yet, so the "correction" is the whole award.
 *
 * `seatsFilled` may be supplied by a caller that has already decided the roster — the close knows
 * exactly who it just confirmed, who it just marked a no-show, and which guests it just seated, and
 * a fresh count could race its own writes.
 */
export async function settleDriveAward(
  admin: AdminClient,
  trip: { id: string; driver_id: string; group_id: string },
  seatsFilled?: number,
): Promise<DriveAwardResult> {
  const { data: group, error: groupError } = await admin
    .from("group")
    .select("drive_weight, pool_weight, pool_step")
    .eq("id", trip.group_id)
    .maybeSingle();
  if (groupError || !group) {
    return { written: null, total: 0, error: groupError?.message ?? "group_not_found" };
  }
  const weights: CloseWeights = {
    driveWeight: group.drive_weight,
    poolWeight: group.pool_weight,
    poolStep: group.pool_step,
  };

  let seats = seatsFilled;
  if (seats === undefined) {
    // Guests count alongside registered riders: a guest fills a seat, so they pay the driver's fill
    // bonus even though they hold no profile and earn nothing themselves (D-09). Counting SEATS
    // rather than profiles is what D-55 made load-bearing — a roster guest's seat has no profile_id.
    const { count, error: seatError } = await admin
      .from("trip_rider")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", trip.id)
      .in("state", ["joined", "confirmed"]);
    if (seatError) return { written: null, total: 0, error: seatError.message };
    seats = count ?? 0;
  }

  const paid = await driveAwardPaid(admin, trip.id, trip.driver_id);
  if (paid === null) {
    return { written: null, total: computeDriveAward(seats, weights).points, error: "ledger_read_failed" };
  }

  const { entry, total } = computeDriveCorrection(paid, seats, weights);
  if (!entry) return { written: null, total };

  const { error: insertError } = await admin.from("points_ledger").insert({
    profile_id: trip.driver_id,
    group_id: trip.group_id,
    trip_id: trip.id,
    kind: entry.kind,
    points: entry.points,
    reason: entry.reason,
  });
  if (insertError) return { written: null, total: paid, error: insertError.message };

  return { written: entry, total };
}
