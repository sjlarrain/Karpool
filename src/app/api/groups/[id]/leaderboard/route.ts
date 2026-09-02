import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";
import { aggregateLedger, rankLeaderboard, formatWeightsCaption } from "@/domain/leaderboard";
import type { LedgerRow, LeaderboardEntry } from "@/domain/leaderboard";

// GET /api/groups/:id/leaderboard — ALL-TIME ranking, weighted per the group's own
// drive/pool/kudos weights (D-11). Every group member appears, even with no points yet.
//
// D-12 REVERSED (developer, 2026-09-01: "Points are all time"). This view used to reset every
// calendar month while the ledger stayed all-time. That window was the sole source of the two bugs
// fixed earlier the same day — a round trip whose legs closed either side of midnight on the 1st
// was split across two leaderboards, and every attempt to pick the "right" month for it was a
// choice between two wrong answers. With no window there is no boundary to straddle, so the whole
// class is gone: the leaderboard is now simply the ledger, which was always all-time anyway.
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

  // Every ledger row this group has ever written — no date filter at all (D-12 reversed).
  const { data: ledgerRows } = await supabase
    .from("points_ledger")
    .select("profile_id, kind, points")
    .eq("group_id", id);

  // D-49: `pooled` is a count of rides taken, not of ledger rows — riding earns nothing, so there
  // is no ledger row to count. Counted from the seats themselves, all-time like the points beside
  // it, so both halves of a member's line always cover the same rides.
  const { data: closedTrips } = await supabase
    .from("trip")
    .select("id")
    .eq("group_id", id)
    .eq("status", "closed");
  const closedTripIds = (closedTrips ?? []).map((t) => t.id);

  const { data: pooledSeats } = closedTripIds.length > 0
    ? await supabase
        .from("trip_rider")
        .select("profile_id")
        .in("trip_id", closedTripIds)
        .eq("state", "confirmed")
        .not("profile_id", "is", null)
    : { data: [] };

  const pooledRides = new Map<string, number>();
  for (const seat of pooledSeats ?? []) {
    if (!seat.profile_id) continue;
    pooledRides.set(seat.profile_id, (pooledRides.get(seat.profile_id) ?? 0) + 1);
  }

  const rows: LedgerRow[] = (ledgerRows ?? []).map((r) => ({
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
