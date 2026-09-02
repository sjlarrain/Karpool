import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";
import { aggregateLedger } from "@/domain/leaderboard";
import type { LedgerRow } from "@/domain/leaderboard";

const querySchema = z.object({ groupId: z.string().uuid() });

// GET /api/me/points?groupId=<uuid> — the caller's own all-time totals **for one group**.
//
// `groupId` is REQUIRED, with no default (developer, 2026-09-01: "My tab must be explicit for the
// group that I am in"). This route used to sum every group the caller belonged to while the YOU tab
// rendered the numbers directly under that tab's group name and member count — so a member of two
// groups read one group's heading over both groups' totals, and their own tab disagreed with the
// Ranks tab beside it. Making the parameter required rather than defaulting to "all groups" is the
// same rule D-49 applied to `aggregateLedger`'s rider count and D-35(C) to `wantsReturn`: a caller
// that forgets to say which group gets a 400, not a plausible-looking wrong answer.
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ groupId: searchParams.get("groupId") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }
  const { groupId } = parsed.data;

  // Authorize: totals for a group you are not in are not yours to read. Same 404-for-a-non-member
  // shape as GET /api/groups/:id/leaderboard, so neither route reveals that a group exists.
  const { data: membership } = await supabase
    .from("membership")
    .select("id")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // All-time, matching the group leaderboard exactly since D-12 was reversed (2026-09-01). The two
  // views now differ only in who they cover, never in what period — so a member's own tab and their
  // row on the Ranks tab cannot disagree.
  const { data: ledgerRows } = await supabase
    .from("points_ledger")
    .select("profile_id, kind, points")
    .eq("profile_id", user.id)
    .eq("group_id", groupId);

  // D-29: how many rides the caller took *through a stop* this calendar month — the motivation
  // counter. Deliberately not a ledger entry: it scores nothing, so it can't inflate the
  // leaderboard, can't be gamed by tagging, and can be dropped again without touching history.
  // Month-scoped (not all-time like the totals above) because a streak you can reset is the part
  // that motivates — D-12's reversal was about points, and this is deliberately not one.
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // Every trip in THIS group the caller was confirmed on. Scoping the seats by group as well as by
  // profile is what keeps `pooled` honest for a member of more than one group.
  const { data: riddenRows } = await supabase
    .from("trip_rider")
    .select("trip_id, trip!inner(group_id)")
    .eq("profile_id", user.id)
    .eq("state", "confirmed")
    .eq("trip.group_id", groupId);
  const riddenIds = [...new Set((riddenRows ?? []).map((r) => r.trip_id))];

  // D-49: riding earns no points and writes no ledger row, so `pooled` is counted from the rides
  // themselves — every closed trip in this group the caller was confirmed on.
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
      .eq("group_id", groupId)
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

  return NextResponse.json({ ...stats, stopsThisMonth, groupId });
}
