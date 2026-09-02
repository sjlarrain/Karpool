import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/audit";

// POST /api/trips/:id/guests — the driver seats a guest from the group's roster (D-55).
//
// The guest twin of POST /riders, and the reason D-24 is honoured rather than reversed: the
// developer rejected free-text guests in the pre-trip flow in favour of "group members only, picked
// from a list". This is that list, extended to the people who have no account yet — a driver still
// picks, never types, and the seat counts against capacity like any other.
//
// Nobody is notified: a guest has no profile and no device. That is the one thing this route does
// not share with POST /riders.

const bodySchema = z.object({
  groupGuestId: z.string().uuid(),
});

const STATUS_BY_ERROR: Record<string, number> = {
  trip_not_found: 404,
  guest_not_found: 404,
  not_driver: 403,
  wrong_status: 409,
  wrong_group: 403,
  already_joined: 409,
  full: 409,
};

const MESSAGE_BY_ERROR: Record<string, string> = {
  not_driver: "Only the driver can seat a guest.",
  wrong_status: "This trip is no longer taking passengers.",
  wrong_group: "That guest belongs to another group.",
  already_joined: "They already have a seat on this trip.",
  full: "The car is full.",
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  // RLS (is_member) makes this null for a non-member, giving the same 404 as a missing trip.
  const { data: trip } = await supabase.from("trip").select("id").eq("id", id).maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  // Driver, status, group and capacity are all checked inside the function, under the same row lock
  // add_trip_rider uses — a guest and a self-joining rider racing for the last seat is the exact
  // case that lock exists for.
  const { data: seated, error } = await admin.rpc("add_trip_guest", {
    p_trip_id: id,
    p_group_guest_id: parsed.data.groupGuestId,
    p_added_by: user.id,
  });

  if (error || !seated) {
    const code = error?.message ?? "add_guest_failed";
    const status = STATUS_BY_ERROR[code] ?? 500;
    return NextResponse.json({ error: code, message: MESSAGE_BY_ERROR[code] }, { status });
  }

  await writeAuditLog(admin, {
    actorProfileId: user.id,
    action: "trip_guest_seated_by_driver",
    entityType: "trip_rider",
    entityId: Array.isArray(seated) ? seated[0]?.id : seated.id,
    after: { tripId: id, groupGuestId: parsed.data.groupGuestId },
    request,
  });

  return NextResponse.json({ tripRider: seated }, { status: 201 });
}
