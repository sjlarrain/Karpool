import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";
import { aggregateLedger, rankLeaderboard, formatWeightsCaption, tripsInMonth } from "@/domain/leaderboard";
import type { LedgerRow, LeaderboardEntry } from "@/domain/leaderboard";

// GET /api/groups/:id/leaderboard — calendar-month ranking (D-12: the ledger itself stays
// all-time, only this view's window resets monthly), weighted per the group's own drive/pool/kudos
// weights (D-11). Every group member appears, even with zero points this month.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("membership")
    .select("id")
    .eq("group_id", id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: group } = await supabase
    .from("group")
    .select("drive_weight, pool_weight, kudos_weight, pool_step")
    .eq("id", id)
    .maybeSingle();
  if (!group) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: members } = await supabase
    .from("membership")
    .select("profile_id")
    .eq("group_id", id);
  const memberIds = (members ?? []).map((m) => m.profile_id);

  const { data: profiles } = await supabase
    .from("profile")
    .select("id, display_name, initials, avatar_color")
    .in("id", memberIds.length > 0 ? memberIds : [""]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  // D-50 follow-up: a round trip's return leg is its own `trip` row with its own `closed_at`
  // (D-35), so windowing straight off timestamps split a single ride across the calendar-month
  // boundary whenever its legs happened to close on either side of it. Every closed trip in the
  // group is fetched (cheap — three columns, id/parent/depart) and `tripsInMonth()` attributes
  // both legs of a round trip to the SAME month via the outbound's `depart_at`, so a back leg
  // closed after midnight on the 1st still counts toward the month the ride was actually taken.
  const { data: closedTrips } = await supabase
    .from("trip")
    .select("id, parent_trip_id, depart_at")
    .eq("group_id", id)
    .eq("status", "closed");
  const tripIdsThisMonth = tripsInMonth(
    (closedTrips ?? []).map((t) => ({ id: t.id, parentTripId: t.parent_trip_id, departAt: t.depart_at })),
    new Date(monthStart),
    new Date(monthEnd),
  );

  // points_ledger rows carry a trip_id for everything a trip close writes (drive, kudos, no_show),
  // windowed by the trip set above; an admin_adjust row has no trip to anchor to, so it keeps the
  // original ledger-timestamp window (D-12's original rule, unchanged for the one kind it still
  // applies to).
  const [{ data: tripLedgerRows }, { data: adjustLedgerRows }] = await Promise.all([
    tripIdsThisMonth.length > 0
      ? supabase.from("points_ledger").select("profile_id, kind, points").eq("group_id", id).in("trip_id", tripIdsThisMonth)
      : Promise.resolve({ data: [] }),
    supabase
      .from("points_ledger")
      .select("profile_id, kind, points")
      .eq("group_id", id)
      .is("trip_id", null)
      .gte("created_at", monthStart)
      .lt("created_at", monthEnd),
  ]);

  // D-49: `pooled` is a count of rides taken, not of ledger rows — riding earns nothing, so
  // there is no ledger row to count. Sourced from the seats themselves, using the same trip set as
  // the ledger rows above so both halves of a member's line cover exactly the same rides.
  const { data: pooledSeats } = tripIdsThisMonth.length > 0
    ? await supabase
        .from("trip_rider")
        .select("profile_id")
        .in("trip_id", tripIdsThisMonth)
        .eq("state", "confirmed")
        .not("profile_id", "is", null)
    : { data: [] };

  const pooledRides = new Map<string, number>();
  for (const seat of pooledSeats ?? []) {
    if (!seat.profile_id) continue;
    pooledRides.set(seat.profile_id, (pooledRides.get(seat.profile_id) ?? 0) + 1);
  }

  const rows: LedgerRow[] = [...(tripLedgerRows ?? []), ...(adjustLedgerRows ?? [])].map((r) => ({
    profileId: r.profile_id,
    kind: r.kind,
    points: r.points,
  }));
  const stats = aggregateLedger(rows, pooledRides);

  const entries: LeaderboardEntry[] = (profiles ?? []).map((p) => {
    const s = stats.get(p.id) ?? { driven: 0, pooled: 0, kudos: 0, points: 0 };
    return {
      profileId: p.id,
      name: p.display_name,
      initials: p.initials,
      color: p.avatar_color,
      ...s,
    };
  });

  return NextResponse.json({
    entries: rankLeaderboard(entries),
    formula: formatWeightsCaption({
      driveWeight: group.drive_weight,
      poolWeight: group.pool_weight,
      poolStep: group.pool_step,
      kudosWeight: group.kudos_weight,
    }),
    viewerProfileId: user.id,
  });
}
