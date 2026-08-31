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

  // D-29: how many rides the caller took *through a stop* this calendar month — the motivation
  // counter. Deliberately not a ledger entry: it scores nothing, so it can't inflate the
  // leaderboard, can't be gamed by tagging, and can be dropped again without touching history.
  // Month-scoped (not all-time like the totals above) because a streak you can reset is the part
  // that motivates; D-12 already set calendar month as this app's period.
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const { data: riddenRows } = await supabase
    .from("trip_rider")
    .select("trip_id")
    .eq("profile_id", user.id)
    .eq("state", "confirmed");
  const riddenIds = [...new Set((riddenRows ?? []).map((r) => r.trip_id))];

  // D-49: riding earns no points and writes no ledger row, so `pooled` is counted from the rides
  // themselves — every closed trip this profile was confirmed on. All-time, matching the totals
  // above (D-12: only the group leaderboard is month-scoped).
  const { data: closedRidden } = riddenIds.length > 0
    ? await supabase.from("trip").select("id").in("id", riddenIds).eq("status", "closed")
    : { data: [] };

  const rows: LedgerRow[] = (ledgerRows ?? []).map((r) => ({ profileId: r.profile_id, kind: r.kind, points: r.points }));
  const pooledRides = new Map<string, number>([[user.id, (closedRidden ?? []).length]]);
  const stats = aggregateLedger(rows, pooledRides).get(user.id) ?? { driven: 0, pooled: 0, kudos: 0, points: 0 };

  const [{ data: drovenWithStop }, { data: riddenWithStop }] = await Promise.all([
    supabase
      .from("trip")
      .select("id")
      .eq("driver_id", user.id)
      .eq("status", "closed")
      .gte("depart_at", monthStart.toISOString())
      .or("out_stop_id.not.is.null,back_stop_id.not.is.null"),
    riddenIds.length > 0
      ? supabase
          .from("trip")
          .select("id")
          .in("id", riddenIds)
          .eq("status", "closed")
          .gte("depart_at", monthStart.toISOString())
          .or("out_stop_id.not.is.null,back_stop_id.not.is.null")
      : Promise.resolve({ data: [] }),
  ]);

  // A driver is never also a rider on their own trip, but the union is cheap and keeps the count
  // honest if that ever changes.
  const stopsThisMonth = new Set([
    ...(drovenWithStop ?? []).map((t) => t.id),
    ...(riddenWithStop ?? []).map((t) => t.id),
  ]).size;

  return NextResponse.json({ ...stats, stopsThisMonth });
}
