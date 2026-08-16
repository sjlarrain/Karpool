import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { transition, type TripTransitionErrorCode } from "@/domain/tripMachine";

const STATUS_BY_ERROR: Record<TripTransitionErrorCode, number> = {
  not_driver: 403,
  wrong_status: 409,
  too_early: 409,
};

// POST /api/trips/:id/close — driver only. Phase 3 scope: the bare status transition only. The
// full close flow (confirm riders, add guest riders, award drive/pool points, notify for kudos) is
// Phase 4's "feat(points)" commit, which will extend this same endpoint.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: trip } = await supabase.from("trip").select("driver_id, status, depart_at").eq("id", id).maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = transition(
    { status: trip.status, driverId: trip.driver_id, departAt: trip.depart_at },
    "close",
    { profileId: user.id },
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS_BY_ERROR[result.error] });
  }

  const admin = createSupabaseAdminClient();
  const { data: updated, error } = await admin
    .from("trip")
    .update({ status: result.nextStatus, closed_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "update_failed", message: error?.message }, { status: 500 });
  }

  return NextResponse.json({ trip: updated });
}
