import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { closeTrip } from "@/lib/api/closeTrip";

const bodySchema = z.object({
  // trip_rider row ids (not profile ids) of currently-active registered riders the driver confirms
  // actually rode. Any active registered rider not listed here is marked no_show. Ignored on a
  // restricted close — see below.
  confirmedTripRiderIds: z.array(z.string().uuid()).default([]),
  guestNames: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  // D-55: guests picked from the group's roster. Separate from guestNames because these carry an
  // identity — their ride is counted and can be linked to an account later, where a free-text
  // name still counts for nobody (D-09).
  groupGuestIds: z.array(z.string().uuid()).max(20).default([]),
});

// POST /api/trips/:id/close — started -> closed. Confirms riders, awards the driver 1 "drive" +
// 1 escalating "pool" per confirmed rider, and queues the kudos prompt.
//
// D-35 mechanic (i), as narrowed by the developer on 2026-08-30: no longer driver-only, but open
// to the GROUP ADMIN only — not to riders. On a round trip the close is also what materialises the
// return leg, so a driver who forgets would strand everyone who declared a return; someone has to
// be able to close it for them. That someone is the admin. A close decides who rode and moves
// points, which is not an authority one passenger should hold over another.
//
// The admin gets the RESTRICTED close: every active rider is confirmed, nobody can be marked a
// no-show, and the body's confirmedTripRiderIds/guestNames are ignored. Deciding that a colleague
// did not show up is a judgement only the driver was there to make.
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

  const { data: membership } = await admin
    .from("membership")
    .select("group_role")
    .eq("group_id", trip.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();

  const result = await closeTrip({
    tripId: id,
    actor: {
      profileId: user.id,
      isGroupAdmin: membership?.group_role === "group_admin",
    },
    confirmedTripRiderIds: parsed.data.confirmedTripRiderIds,
    guestNames: parsed.data.guestNames,
    groupGuestIds: parsed.data.groupGuestIds,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });
  }

  return NextResponse.json({
    trip: result.trip,
    mode: result.mode,
    confirmedCount: result.confirmedCount,
    noShowCount: result.noShowCount,
    pointsAwarded: result.pointsAwarded,
    backTripId: result.backTripId,
  });
}
