import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";

// POST /api/trips/:id/leave — drop a seat you're holding. Phase 3 scope: marks the seat left.
// Phase 4 ("feat(points)") adds the 60-minute late-cancellation window check and the -5 point
// ledger entry (D-10/LATE_LEAVE) — no ledger writes happen here yet.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: trip } = await supabase.from("trip").select("status").eq("id", id).maybeSingle();
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

  return NextResponse.json({ tripRider: updated });
}
