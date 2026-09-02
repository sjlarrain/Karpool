import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";
import { aggregateLedger, rankLeaderboard, formatWeightsCaption } from "@/domain/leaderboard";
import type { LedgerRow, LeaderboardEntry } from "@/domain/leaderboard";
import { claimantByGuestId, tallyPooledRides } from "@/domain/guestRoster";
import { loadGuestRoster } from "@/lib/groups/guestRoster";

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

  // D-55: guest seats are no longer filtered out here. A seat now counts for its rider OR for
  // whoever a group admin has linked its guest to, and seatOwner() decides which — so the moment
  // a guest is linked, every ride they ever took appears on that member's line rather than only
  // counting forward. An unlinked guest still counts for nobody, exactly as before.
  const { data: pooledSeats } = closedTripIds.length > 0
    ? await supabase
        .from("trip_rider")
        .select("profile_id, group_guest_id")
        .in("trip_id", closedTripIds)
        .eq("state", "confirmed")
    : { data: [] };

  const roster = await loadGuestRoster(supabase, id);
  if (!roster.ok) {
    return NextResponse.json({ error: roster.error }, { status: 500 });
  }
  const claims = claimantByGuestId(
    roster.guests.map((g) => ({ id: g.id, claimedByProfileId: g.claimedBy?.profileId ?? null })),
  );
  const pooledRides = tallyPooledRides(
    (pooledSeats ?? []).map((s) => ({ profileId: s.profile_id, groupGuestId: s.group_guest_id })),
    claims,
  );

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
      registered: true,
      ...s,
    };
  });

  // D-55, the developer's call: a guest nobody has linked yet appears on the board with the rides
  // they have actually taken, greyed and marked "not registered". It is the nudge to sign up, and
  // it is also how an admin notices there is someone here to link. Claimed guests are absent by
  // construction — their rides are already on a member's line, and listing both would show one
  // ride twice on one screen. Zero-ride guests are left off: a name with no history is roster
  // housekeeping, not a leaderboard row.
  for (const guest of roster.guests) {
    if (guest.claimedBy || guest.rides === 0) continue;
    entries.push({
      profileId: guest.id,
      name: guest.displayName,
      initials: guest.initials,
      color: guest.color,
      registered: false,
      driven: 0,
      pooled: guest.rides,
      kudos: 0,
      points: 0,
    });
  }

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
