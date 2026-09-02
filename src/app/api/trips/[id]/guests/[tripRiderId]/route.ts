import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/audit";

// DELETE /api/trips/:id/guests/:tripRiderId — the driver frees a seat they gave a roster guest.
//
// Separate from DELETE /riders/:riderId rather than folded into it: that route notifies the person
// whose seat was taken back, and a guest has nobody to notify. Marks the seat `left` rather than
// deleting the row, so a guest's history is only ever what they actually rode — a confirmed seat on
// a closed trip — and never a seat that was booked and undone.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; tripRiderId: string }> }) {
  const { id, tripRiderId } = await params;
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
    return NextResponse.json({ error: "not_driver", message: "Only the driver can free that seat." }, { status: 403 });
  }
  if (trip.status !== "scheduled" && trip.status !== "started") {
    return NextResponse.json({ error: "wrong_status", message: "This trip is no longer active." }, { status: 409 });
  }

  const { data: seat, error: seatError } = await supabase
    .from("trip_rider")
    .select("id, group_guest_id, guest_name")
    .eq("id", tripRiderId)
    .eq("trip_id", id)
    .in("state", ["joined", "confirmed"])
    .maybeSingle();
  if (seatError) {
    return NextResponse.json({ error: "seat_lookup_failed", message: seatError.message }, { status: 500 });
  }
  if (!seat || !seat.group_guest_id) {
    // A seat with no roster guest is either a member's (POST /riders owns that) or already gone.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("trip_rider")
    .update({ state: "left", left_at: new Date().toISOString() })
    .eq("id", tripRiderId);
  if (error) {
    return NextResponse.json({ error: "remove_failed", message: error.message }, { status: 500 });
  }

  await writeAuditLog(admin, {
    actorProfileId: user.id,
    action: "trip_guest_removed_by_driver",
    entityType: "trip_rider",
    entityId: tripRiderId,
    before: { tripId: id, groupGuestId: seat.group_guest_id, guestName: seat.guest_name },
    request,
  });

  return NextResponse.json({ ok: true });
}
