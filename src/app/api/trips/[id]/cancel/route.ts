import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { transition, type TripTransitionErrorCode } from "@/domain/tripMachine";
import { NOT_STARTED_REASON } from "@/domain/constants";
import { notifyProfiles } from "@/lib/notify/tripNotify";

const STATUS_BY_ERROR: Record<TripTransitionErrorCode, number> = {
  not_driver: 403,
  // D-35 opened close, and only close, to riders and group admins. start and cancel stay
  // driver-only, so this branch is unreachable here — it exists to keep the map total.
  not_permitted: 403,
  wrong_status: 409,
  too_early: 409,
};

// cancelled_reason carries both the driver's free text and D-23's expiry sentinel, and the badge
// reads "PAST · NEVER STARTED" for the latter. A driver typing that exact string would dress their
// own cancellation up as an expiry, so the one reserved word is refused.
const bodySchema = z.object({
  reason: z.string().trim().max(200).refine((v) => v !== NOT_STARTED_REASON, "reserved value").optional(),
});

// POST /api/trips/:id/cancel — driver only, scheduled trips only (a started trip can no longer be
// cancelled per the state machine).
//
// D-38: the riders are told. A cancellation is the one trip event a rider cannot discover by
// looking — their card simply stops being a ride — and they need the time to find another way in.
// Nobody is charged for a trip the driver called off: the riders never leave the seat, and a
// cancelled trip pays and penalises no one.
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

  // Read before the update: RLS lets the driver see their own trip's riders, and the set is the
  // same either side of the status flip.
  const { data: activeRiders } = await supabase
    .from("trip_rider")
    .select("profile_id")
    .eq("trip_id", id)
    .in("state", ["joined", "confirmed"]);

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

  const reason = parsed.data.reason?.trim();
  const riderProfileIds = (activeRiders ?? []).map((r) => r.profile_id).filter((pid): pid is string => !!pid);
  await notifyProfiles(riderProfileIds, {
    type: "change",
    title: "Trip cancelled",
    // The driver's own words when they gave any — "car trouble" tells a rider more about what to do
    // next than any wording this route could invent.
    body: reason
      ? `Your driver called this trip off: "${reason}". You'll need another way in — no points lost.`
      : "Your driver called this trip off. You'll need another way in — no points lost.",
    tripId: id,
  });

  return NextResponse.json({ trip: updated, notifiedRiders: riderProfileIds.length });
}
