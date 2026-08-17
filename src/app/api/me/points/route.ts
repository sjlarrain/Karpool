import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";
import { aggregateLedger } from "@/domain/leaderboard";
import type { LedgerRow } from "@/domain/leaderboard";

// GET /api/me/points — the caller's own lifetime totals (all-time, across every group they belong
// to — D-12's "ledger stays all-time" applies here; only the group leaderboard view is
// month-scoped).
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: ledgerRows } = await supabase.from("points_ledger").select("profile_id, kind, points").eq("profile_id", user.id);

  const rows: LedgerRow[] = (ledgerRows ?? []).map((r) => ({ profileId: r.profile_id, kind: r.kind, points: r.points }));
  const stats = aggregateLedger(rows).get(user.id) ?? { driven: 0, pooled: 0, kudos: 0, points: 0 };

  return NextResponse.json(stats);
}
