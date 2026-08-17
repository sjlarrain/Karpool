import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { transition, type TripTransitionErrorCode } from "@/domain/tripMachine";
import { computeCloseAwards } from "@/domain/points";

const STATUS_BY_ERROR: Record<TripTransitionErrorCode, number> = {
  not_driver: 403,
  wrong_status: 409,
  too_early: 409,
};

const bodySchema = z.object({
  // trip_rider row ids (not profile ids) of currently-active registered riders the driver confirms
  // actually rode. Any active registered rider not listed here is marked no_show.
  confirmedTripRiderIds: z.array(z.string().uuid()).default([]),
  guestNames: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
});

// POST /api/trips/:id/close — driver only, started->closed. Confirms riders (unconfirmed active
// registered riders become no_show), adds guest riders, awards the driver 1 "drive" + 1 "pool" per
// confirmed rider (registered or guest — points_ledger.profile_id can't reference a guest, so guest
// contributions land on the driver, matching the sketch's "still count toward your pooled score"),
// and queues a "rate" notification for each confirmed registered rider.
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

  const { data: trip } = await supabase
    .from("trip")
    .select("driver_id, status, depart_at, group_id")
    .eq("id", id)
    .maybeSingle();
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

  const { data: group } = await supabase
    .from("group")
    .select("drive_weight, pool_weight")
    .eq("id", trip.group_id)
    .maybeSingle();
  if (!group) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: activeRiders, error: ridersError } = await supabase
    .from("trip_rider")
    .select("id, profile_id")
    .eq("trip_id", id)
    .in("state", ["joined", "confirmed"]);
  if (ridersError) {
    return NextResponse.json({ error: "rider_lookup_failed" }, { status: 500 });
  }

  // Only trip_rider ids that actually belong to this trip's active riders count — a stale or
  // spoofed id in the request body is silently ignored rather than trusted.
  const activeById = new Map((activeRiders ?? []).map((r) => [r.id, r]));
  const confirmedIds = parsed.data.confirmedTripRiderIds.filter((rid) => activeById.has(rid));
  const noShowIds = (activeRiders ?? []).map((r) => r.id).filter((rid) => !confirmedIds.includes(rid));

  const confirmedProfileIds = confirmedIds
    .map((rid) => activeById.get(rid)?.profile_id)
    .filter((pid): pid is string => !!pid);

  const admin = createSupabaseAdminClient();

  if (confirmedIds.length > 0) {
    const { error } = await admin.from("trip_rider").update({ state: "confirmed" }).in("id", confirmedIds);
    if (error) return NextResponse.json({ error: "confirm_failed", message: error.message }, { status: 500 });
  }
  if (noShowIds.length > 0) {
    const { error } = await admin.from("trip_rider").update({ state: "no_show" }).in("id", noShowIds);
    if (error) return NextResponse.json({ error: "no_show_failed", message: error.message }, { status: 500 });
  }

  let insertedGuests: { id: string; guest_name: string | null }[] = [];
  if (parsed.data.guestNames.length > 0) {
    const { data, error } = await admin
      .from("trip_rider")
      .insert(parsed.data.guestNames.map((guestName) => ({ trip_id: id, guest_name: guestName, state: "confirmed" as const })))
      .select("id, guest_name");
    if (error) return NextResponse.json({ error: "guest_add_failed", message: error.message }, { status: 500 });
    insertedGuests = data ?? [];
  }

  const confirmedProfiles =
    confirmedProfileIds.length > 0
      ? await supabase.from("profile").select("id, display_name").in("id", confirmedProfileIds)
      : { data: [] as { id: string; display_name: string }[] };
  const nameByProfileId = new Map((confirmedProfiles.data ?? []).map((p) => [p.id, p.display_name]));

  const riderNames = [
    ...confirmedProfileIds.map((pid) => nameByProfileId.get(pid) ?? "A rider"),
    ...insertedGuests.map((g) => g.guest_name ?? "Guest"),
  ];

  const awards = computeCloseAwards(riderNames, { driveWeight: group.drive_weight, poolWeight: group.pool_weight });
  const { error: ledgerError } = await admin.from("points_ledger").insert(
    awards.map((award) => ({
      profile_id: trip.driver_id,
      group_id: trip.group_id,
      trip_id: id,
      kind: award.kind,
      points: award.points,
      reason: award.reason,
    })),
  );
  if (ledgerError) {
    return NextResponse.json({ error: "ledger_write_failed", message: ledgerError.message }, { status: 500 });
  }

  if (confirmedProfileIds.length > 0) {
    await admin.from("notification").insert(
      confirmedProfileIds.map((profileId) => ({
        profile_id: profileId,
        type: "rate" as const,
        title: "Trip closed — leave kudos",
        body: "Rate your driver's ride and award points.",
        payload: { tripId: id },
      })),
    );
  }

  const { data: updated, error } = await admin
    .from("trip")
    .update({ status: result.nextStatus, closed_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "update_failed", message: error?.message }, { status: 500 });
  }

  return NextResponse.json({
    trip: updated,
    confirmedCount: confirmedProfileIds.length + insertedGuests.length,
    noShowCount: noShowIds.length,
    pointsAwarded: awards.reduce((sum, a) => sum + a.points, 0),
  });
}
