import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";
import { aggregateLedger, rankLeaderboard, formatWeightsCaption } from "@/domain/leaderboard";
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
    .select("drive_weight, pool_weight, kudos_weight")
    .eq("id", id)
    .maybeSingle();
  if (!group) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: members } = await supabase.from("membership").select("profile_id").eq("group_id", id);
  const memberIds = (members ?? []).map((m) => m.profile_id);

  const { data: profiles } = await supabase
    .from("profile")
    .select("id, display_name, initials, avatar_color")
    .in("id", memberIds.length > 0 ? memberIds : [""]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  const { data: ledgerRows } = await supabase
    .from("points_ledger")
    .select("profile_id, kind, points")
    .eq("group_id", id)
    .gte("created_at", monthStart)
    .lt("created_at", monthEnd);

  const rows: LedgerRow[] = (ledgerRows ?? []).map((r) => ({ profileId: r.profile_id, kind: r.kind, points: r.points }));
  const stats = aggregateLedger(rows);

  const entries: LeaderboardEntry[] = (profiles ?? []).map((p) => {
    const s = stats.get(p.id) ?? { driven: 0, pooled: 0, kudos: 0, points: 0 };
    return { profileId: p.id, name: p.display_name, initials: p.initials, color: p.avatar_color, ...s };
  });

  return NextResponse.json({
    entries: rankLeaderboard(entries),
    formula: formatWeightsCaption({ driveWeight: group.drive_weight, poolWeight: group.pool_weight, kudosWeight: group.kudos_weight }),
    viewerProfileId: user.id,
  });
}
