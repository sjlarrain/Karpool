import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/audit";
import { syncDriveAward } from "@/lib/api/driveAward";
import { rosterWindow } from "@/lib/api/rosterWindow";

// POST /api/trips/:id/guests — the driver seats a guest from the group's roster (D-55).
//
// The guest twin of POST /riders, and the reason D-24 is honoured rather than reversed: the
// developer rejected free-text guests in the pre-trip flow in favour of "group members only, picked
// from a list". This is that list, extended to the people who have no account yet — a driver still
// picks, never types, and the seat counts against capacity like any other.
//
// Nobody is notified: a guest has no profile and no device. That is the one thing this route does
// not share with POST /riders.
//
// D-61: also after the ride, until the end of that day, for a guest who rode without a seat. Only
// then does it take a typed `guestName` as well — D-09's "just this once" guest, which used to live
// on the close screen. Before departure the driver still picks from the roster (D-24).

const bodySchema = z.union([
  z.object({ groupGuestId: z.string().uuid() }),
  z.object({ guestName: z.string().trim().min(1).max(60) }),
]);

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
  const { data: trip } = await supabase
    .from("trip")
    .select("id, driver_id, status, depart_at, capacity")
    .eq("id", id)
    .maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const gate = await rosterWindow(trip);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error, message: gate.message }, { status: 409 });
  }

  const admin = createSupabaseAdminClient();

  if ("guestName" in parsed.data) {
    if (trip.driver_id !== user.id) {
      return NextResponse.json({ error: "not_driver", message: MESSAGE_BY_ERROR.not_driver }, { status: 403 });
    }
    if (!gate.settled) {
      return NextResponse.json(
        { error: "wrong_status", message: "Before the ride, pick guests from the group's list." },
        { status: 409 },
      );
    }
    // No row lock needed here, unlike add_trip_guest: a settled trip takes no self-serve joins, so
    // the driver is the only writer to its roster.
    const { count, error: countError } = await admin
      .from("trip_rider")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", id)
      .in("state", ["joined", "confirmed"]);
    if (countError) {
      return NextResponse.json({ error: "add_guest_failed", message: countError.message }, { status: 500 });
    }
    if ((count ?? 0) >= trip.capacity) {
      return NextResponse.json({ error: "full", message: MESSAGE_BY_ERROR.full }, { status: 409 });
    }
    const { data: seated, error: insertError } = await admin
      .from("trip_rider")
      .insert({ trip_id: id, guest_name: parsed.data.guestName, state: "confirmed", added_by_profile_id: user.id })
      .select()
      .single();
    if (insertError || !seated) {
      return NextResponse.json({ error: "add_guest_failed", message: insertError?.message }, { status: 500 });
    }
    const award = await syncDriveAward(admin, id);
    await writeAuditLog(admin, {
      actorProfileId: user.id,
      action: "trip_guest_seated_by_driver",
      entityType: "trip_rider",
      entityId: seated.id,
      after: { tripId: id, guestName: parsed.data.guestName },
      request,
    });
    return NextResponse.json(
      { tripRider: seated, pointsAdjusted: award.written?.points ?? 0, awardError: award.error ?? null },
      { status: 201 },
    );
  }

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

  // A guest fills a seat and so pays the driver's fill bonus (D-09), which means seating one on a
  // settled trip re-prices the ride exactly as seating a member does.
  const award = await syncDriveAward(admin, id);

  await writeAuditLog(admin, {
    actorProfileId: user.id,
    action: "trip_guest_seated_by_driver",
    entityType: "trip_rider",
    entityId: Array.isArray(seated) ? seated[0]?.id : seated.id,
    after: { tripId: id, groupGuestId: parsed.data.groupGuestId },
    request,
  });

  return NextResponse.json(
    { tripRider: seated, pointsAdjusted: award.written?.points ?? 0, awardError: award.error ?? null },
    { status: 201 },
  );
}
