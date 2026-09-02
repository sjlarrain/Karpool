import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { startTrip } from "@/lib/api/startTrip";

// POST /api/trips/:id/start — scheduled -> started, not before T-2h (D-16). Driver, or (D-50,
// 2026-09-01) the group admin starting a trip the driver forgot to. Pure transition logic lives in
// src/domain/tripMachine.ts and is exhaustively tested there; the write itself is shared with the
// admin console's force-start via src/lib/api/startTrip.ts.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // RLS (is_member) makes this null for a non-member, giving the same 404 as a missing trip.
  const { data: trip } = await supabase.from("trip").select("id, group_id").eq("id", id).maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const { data: membership } = await admin
    .from("membership")
    .select("group_role")
    .eq("group_id", trip.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();

  const result = await startTrip(id, {
    profileId: user.id,
    isGroupAdmin: membership?.group_role === "group_admin",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });
  }

  return NextResponse.json({
    trip: result.trip,
    notifiedRiders: result.notifiedRiders,
    pushDelivery: result.pushDelivery,
  });
}
