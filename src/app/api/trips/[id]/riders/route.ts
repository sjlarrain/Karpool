import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { notifyProfiles } from "@/lib/notify/tripNotify";
import { writeAuditLog } from "@/lib/audit";

const bodySchema = z.object({ profileId: z.string().uuid() });

const STATUS_BY_ERROR: Record<string, number> = {
  trip_not_found: 404,
  not_driver: 403,
  is_driver: 409,
  wrong_status: 409,
  not_member: 409,
  already_joined: 409,
  full: 409,
};

const MESSAGE_BY_ERROR: Record<string, string> = {
  not_driver: "Only the driver can add passengers to this trip.",
  is_driver: "You're driving this trip.",
  wrong_status: "This trip is no longer active.",
  not_member: "They're not in this carpool group.",
  already_joined: "They're already riding this trip.",
  full: "There's no seat left on this trip.",
};

// POST /api/trips/:id/riders — D-24: the driver seats a group member who asked for the ride in
// person. Driver-only, members-only, and it goes through add_trip_rider() (migration 0010) so it
// takes the same row lock as a self-serve join — a driver adding someone while a rider joins is
// exactly the race that function exists to close.
//
// The seat is marked added_by_profile_id, which is what lets POST /leave waive the late
// cancellation penalty: this passenger never booked the seat, so dropping it isn't their fault.
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

  // RLS (is_member) makes this null for a non-member, giving the same 404 as a missing trip.
  const { data: trip } = await supabase.from("trip").select("id, group_id").eq("id", id).maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const { data: added, error } = await admin.rpc("add_trip_rider", {
    p_trip_id: id,
    p_profile_id: parsed.data.profileId,
    p_added_by: user.id,
  });

  if (error || !added) {
    const code = error?.message ?? "add_failed";
    const status = STATUS_BY_ERROR[code] ?? 500;
    return NextResponse.json({ error: code, message: MESSAGE_BY_ERROR[code] }, { status });
  }

  // Being put on someone's trip without asking is exactly the kind of thing a person needs to be
  // told about — they can leave from the notification, penalty-free.
  await notifyProfiles([parsed.data.profileId], {
    type: "change",
    title: "You've been added to a ride",
    body: "Your driver added you as a passenger. Open the trip to see the details, or leave if you're not going.",
    tripId: id,
  });

  await writeAuditLog(admin, {
    actorProfileId: user.id,
    action: "trip_rider_added_by_driver",
    entityType: "trip_rider",
    entityId: (added as { id: string }).id,
    after: { trip_id: id, profile_id: parsed.data.profileId },
    request,
  });

  return NextResponse.json({ tripRider: added }, { status: 201 });
}
