import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { transition, type TripTransitionErrorCode } from "@/domain/tripMachine";

const STATUS_BY_ERROR: Record<TripTransitionErrorCode, number> = {
  not_driver: 403,
  // D-35 opened close, and only close, to riders and group admins. start and cancel stay
  // driver-only, so this branch is unreachable here — it exists to keep the map total.
  not_permitted: 403,
  wrong_status: 409,
  too_early: 409,
};

const bodySchema = z.object({ reason: z.string().trim().max(200).optional() });

// POST /api/trips/:id/cancel — driver only, scheduled trips only (a started trip can no longer be
// cancelled per the state machine).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const { data: trip } = await supabase.from("trip").select("driver_id, status, depart_at").eq("id", id).maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = transition(
    { status: trip.status, driverId: trip.driver_id, departAt: trip.depart_at },
    "cancel",
    { profileId: user.id },
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS_BY_ERROR[result.error] });
  }

  const admin = createSupabaseAdminClient();
  const { data: updated, error } = await admin
    .from("trip")
    .update({ status: result.nextStatus, cancelled_reason: parsed.data.reason ?? null })
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "update_failed", message: error?.message }, { status: 500 });
  }

  return NextResponse.json({ trip: updated });
}
