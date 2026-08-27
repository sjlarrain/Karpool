import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { notifyProfiles } from "@/lib/notify/tripNotify";
import { writeAuditLog } from "@/lib/audit";

// DELETE /api/trips/:id/riders/:riderId — D-24: the driver takes back a seat they booked for
// someone. Deliberately limited to seats the driver added (added_by_profile_id is set): a rider who
// chose to join gives up their own seat through POST /leave, and a driver must not be able to bump
// them off a ride they were counting on.
//
// No penalty is written either way — the driver undoing their own action isn't a late cancellation.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; riderId: string }> }) {
  const { id, riderId } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: trip } = await supabase.from("trip").select("id, driver_id, status").eq("id", id).maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (trip.driver_id !== user.id) {
    return NextResponse.json(
      { error: "not_driver", message: "Only the driver can remove a passenger." },
      { status: 403 },
    );
  }
  if (trip.status !== "scheduled" && trip.status !== "started") {
    return NextResponse.json({ error: "wrong_status", message: "This trip is no longer active." }, { status: 409 });
  }

  const { data: seat } = await supabase
    .from("trip_rider")
    .select("id, profile_id, added_by_profile_id, state")
    .eq("id", riderId)
    .eq("trip_id", id)
    .maybeSingle();
  if (!seat || (seat.state !== "joined" && seat.state !== "confirmed")) {
    return NextResponse.json({ error: "not_found", message: "That passenger isn't on this trip." }, { status: 404 });
  }
  if (!seat.added_by_profile_id) {
    return NextResponse.json(
      { error: "not_added_by_driver", message: "They joined this trip themselves — only they can leave it." },
      { status: 403 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { data: updated, error } = await admin
    .from("trip_rider")
    .update({ state: "left", left_at: new Date().toISOString() })
    .eq("id", seat.id)
    .select()
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "remove_failed", message: error?.message }, { status: 500 });
  }

  if (seat.profile_id) {
    await notifyProfiles([seat.profile_id], {
      type: "change",
      title: "You were taken off a ride",
      body: "Your driver removed the seat they'd added for you.",
      tripId: id,
    });
  }

  await writeAuditLog(admin, {
    actorProfileId: user.id,
    action: "trip_rider_removed_by_driver",
    entityType: "trip_rider",
    entityId: seat.id,
    before: { state: seat.state },
    after: { state: "left" },
    request,
  });

  return NextResponse.json({ tripRider: updated });
}
