import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { computeDriveAward, computeDriveCorrection, type CloseWeights, type LedgerAward } from "@/domain/points";

// The driver's award, and every later correction to it.
//
// D-56 paid it at Start; D-61 (2026-09-19) pays it when the scheduler settles the trip at its
// departure (src/lib/api/settleTrip.ts). Either way the first payment is a forecast of the seats,
// and the driver can still put the list right until the end of that day — seat someone who rode
// without booking, or report someone who didn't show. points_ledger is append-only
// (CLAUDE.md §3.5), so a correction is a NEW row carrying the difference, never an edit.
//
// Every correction is derived from what the ledger already holds rather than from the change that
// triggered it, which is the property that makes this safe to call from several routes and the
// scheduler at once: a correction lost to a failure is re-derived by the next one, and one applied
// twice owes nothing the second time.
//
// Seats counted: `joined`, `confirmed` AND `no_show`. D-61's no-show report leaves the driver's
// seat pay alone ("+2 for the driver", on top) — they held the seat and drove — so a reported
// no-show is still a paid seat, and a later correction must not claw it back.

const PAID_SEAT_STATES = ["joined", "confirmed", "no_show"] as const;

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export interface DriveAwardResult {
  // The row written, or null when the driver already held exactly what they were owed.
  written: LedgerAward | null;
  // The driver's whole award for this trip once `written` has landed.
  total: number;
  // Set when the correction could not be written. NOT thrown and NOT swallowed: the roster change
  // that triggered it has already succeeded, so failing the caller's request would be a lie, but a
  // silent miss would be a leaderboard that quietly drifts (the D-41 failure, by another route).
  // The routes echo this back, and the next correction re-derives it anyway.
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
 * Re-price a settled trip against its current roster and append the difference.
 *
 * A no-op for any trip that is not `closed`: a scheduled trip has not been paid yet, and a
 * cancelled one never will be. That guard is why the roster routes can call this unconditionally.
 */
export async function syncDriveAward(admin: AdminClient, tripId: string): Promise<DriveAwardResult> {
  const { data: trip, error } = await admin
    .from("trip")
    .select("id, driver_id, group_id, status")
    .eq("id", tripId)
    .maybeSingle();
  if (error) return { written: null, total: 0, error: error.message };
  if (!trip) return { written: null, total: 0, error: "trip_not_found" };
  if (trip.status !== "closed") return { written: null, total: 0 };
  return settleDriveAward(admin, trip);
}

/**
 * The one write. Counts the paid seats, reads what has been paid, appends the difference. On the
 * settle there is nothing on the ledger yet, so the "correction" is the whole award.
 */
export async function settleDriveAward(
  admin: AdminClient,
  trip: { id: string; driver_id: string; group_id: string },
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

  // Guests count alongside registered riders: a guest fills a seat, so they pay the driver's fill
  // bonus even though they hold no profile and earn nothing themselves (D-09). Counting SEATS rather
  // than profiles is what D-55 made load-bearing — a roster guest's seat has no profile_id.
  const { count, error: seatError } = await admin
    .from("trip_rider")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", trip.id)
    .in("state", [...PAID_SEAT_STATES]);
  if (seatError) return { written: null, total: 0, error: seatError.message };
  const seats = count ?? 0;

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
