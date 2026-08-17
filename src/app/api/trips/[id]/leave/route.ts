import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { computeLateLeavePenalty } from "@/domain/points";

// POST /api/trips/:id/leave — drop a seat you're holding. Marks the seat left and, if inside the
// group's cancellation window (D-10/LATE_LEAVE, per-group configurable), writes a late_leave
// penalty entry to points_ledger for the leaving rider.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: trip } = await supabase
    .from("trip")
    .select("status, depart_at, group_id")
    .eq("id", id)
    .maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (trip.status !== "scheduled" && trip.status !== "started") {
    return NextResponse.json({ error: "wrong_status", message: "This trip is no longer active." }, { status: 409 });
  }

  const { data: seat } = await supabase
    .from("trip_rider")
    .select("id")
    .eq("trip_id", id)
    .eq("profile_id", user.id)
    .in("state", ["joined", "confirmed"])
    .maybeSingle();
  if (!seat) {
    return NextResponse.json({ error: "not_found", message: "You're not riding this trip." }, { status: 404 });
  }

  const { data: group } = await supabase
    .from("group")
    .select("late_window_minutes, late_penalty")
    .eq("id", trip.group_id)
    .maybeSingle();

  const penalty = group
    ? computeLateLeavePenalty(new Date(trip.depart_at), new Date(), group.late_window_minutes, group.late_penalty)
    : null;

  const admin = createSupabaseAdminClient();
  const { data: updated, error } = await admin
    .from("trip_rider")
    .update({ state: "left", left_at: new Date().toISOString() })
    .eq("id", seat.id)
    .select()
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "leave_failed", message: error?.message }, { status: 500 });
  }

  if (penalty) {
    await admin.from("points_ledger").insert({
      profile_id: user.id,
      group_id: trip.group_id,
      trip_id: id,
      kind: penalty.kind,
      points: penalty.points,
      reason: penalty.reason,
    });
  }

  return NextResponse.json({ tripRider: updated, latePenalty: penalty?.points ?? null });
}
