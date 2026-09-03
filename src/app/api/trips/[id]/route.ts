import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { SEATS } from "@/domain/constants";
import { resolveTripStops } from "@/lib/trips/resolveStops";
import { stopView, toTripView } from "@/domain/toTripView";
import { viewerTimeZone } from "@/lib/time/viewerTimeZone";
import type { TripRiderRowInput, TripRowInput } from "@/domain/toTripView";
import type { TripStopView } from "@/domain/types";
import { decorateTrip } from "@/domain/decorateTrip";
import { notifyProfiles } from "@/lib/notify/tripNotify";
import { diffTripEdit } from "@/domain/tripEdit";
import { isDepartureInPast, isReturnBeforeDeparture } from "@/domain/tripSchedule";
import { parkingUrlForLeg } from "@/domain/parking";
import { loadGuestRoster } from "@/lib/groups/guestRoster";

// GET /api/trips/:id — trip detail overlay: decorated summary + the driver's pickup list in route
// order. RLS (is_member) makes this 404 rather than 403 for a non-member (plan's "404 never leaks
// existence across groups").
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: trip, error: tripError } = await supabase.from("trip").select("*").eq("id", id).maybeSingle();
  if (tripError) {
    return NextResponse.json({ error: "trip_lookup_failed" }, { status: 500 });
  }
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [{ data: group }, { data: driver }, { data: riderRows, error: ridersError }] = await Promise.all([
    supabase
      .from("group")
      .select("origin_label, dest_label, parking_url_out, parking_url_back")
      .eq("id", trip.group_id)
      .maybeSingle(),
    supabase.from("profile").select("id, display_name, initials, avatar_color").eq("id", trip.driver_id).maybeSingle(),
    supabase
      .from("trip_rider")
      .select(
        "id, profile_id, group_guest_id, guest_name, pickup_place_id, stop_order, state, added_by_profile_id, penalty_waived_at",
      )
      .eq("trip_id", id)
      .in("state", ["joined", "confirmed"])
      .order("stop_order", { ascending: true, nullsFirst: false }),
  ]);

  if (!group || !driver) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Never swallowed. A failed rider query returns `null`, which is indistinguishable from "nobody
  // has joined" — so the route would answer 200 with an empty car, and a rider who *is* aboard
  // would be shown "Request to join" on a seat they already hold. That is how a missing column
  // reads as a UI bug instead of an error (it cost a debugging session on 2026-08-30).
  if (ridersError) {
    return NextResponse.json({ error: "rider_lookup_failed", message: ridersError.message }, { status: 500 });
  }

  const riderProfileIds = [...new Set((riderRows ?? []).map((r) => r.profile_id).filter((v): v is string => !!v))];
  // Rider pickup points and the trip's own stops (D-29) live in the same table, so one query
  // fetches both — the extra columns are only read for the stop ids.
  const pickupPlaceIds = [
    ...new Set(
      [...(riderRows ?? []).map((r) => r.pickup_place_id), trip.out_stop_id, trip.back_stop_id].filter(
        (v): v is string => !!v,
      ),
    ),
  ];

  const [{ data: riderProfiles }, { data: pickupPlaces }] = await Promise.all([
    riderProfileIds.length > 0
      ? supabase.from("profile").select("id, display_name, initials, avatar_color").in("id", riderProfileIds)
      : Promise.resolve({ data: [] }),
    pickupPlaceIds.length > 0
      ? supabase.from("pickup_place").select("id, label, icon, address").in("id", pickupPlaceIds)
      : Promise.resolve({ data: [] }),
  ]);

  const riderProfileById = new Map((riderProfiles ?? []).map((p) => [p.id, p]));
  const pickupLabelById = new Map((pickupPlaces ?? []).map((p) => [p.id, p.label]));
  const placeById = new Map((pickupPlaces ?? []).map((p) => [p.id, p]));

  const activeRiders: TripRiderRowInput[] = (riderRows ?? []).map((r) => {
    const profile = r.profile_id ? riderProfileById.get(r.profile_id) : undefined;
    return {
      profileId: r.profile_id,
      guestName: r.guest_name,
      displayName: profile?.display_name ?? null,
      initials: profile?.initials ?? null,
      avatarColor: profile?.avatar_color ?? null,
    };
  });

  const tripInput: TripRowInput = {
    id: trip.id,
    direction: trip.direction,
    departAt: trip.depart_at,
    returnAt: trip.return_at,
    capacity: trip.capacity,
    status: trip.status,
    driverId: trip.driver_id,
    cancelledReason: trip.cancelled_reason,
    outStop: trip.out_stop_id ? placeById.get(trip.out_stop_id) ?? null : null,
    backStop: trip.back_stop_id ? placeById.get(trip.back_stop_id) ?? null : null,
  };

  const view = toTripView({
    trip: tripInput,
    driver: { id: trip.driver_id, displayName: driver.display_name },
    activeRiders,
    viewerId: user.id,
    originLabel: group.origin_label,
    destLabel: group.dest_label,
    now: new Date(),
    timeZone: await viewerTimeZone(),
  });

  const pickups = (riderRows ?? []).map((r) => {
    const profile = r.profile_id ? riderProfileById.get(r.profile_id) : undefined;
    return {
      id: r.id,
      name: r.profile_id ? (profile?.display_name ?? "Member") : (r.guest_name ?? "Guest"),
      initials: r.profile_id ? (profile?.initials ?? "?") : undefined,
      color: r.profile_id ? (profile?.avatar_color ?? undefined) : undefined,
      pickupLabel: r.pickup_place_id ? (pickupLabelById.get(r.pickup_place_id) ?? null) : null,
      stopOrder: r.stop_order,
      isViewer: r.profile_id === user.id,
      // D-24: a seat the driver booked on this member's behalf. The driver may take it back; a
      // seat someone booked themselves is theirs to give up.
      addedByDriver: r.added_by_profile_id !== null,
      // D-55: a seat held by someone on the group's guest roster. Freed through its own route,
      // because the member one notifies the person whose seat was taken and a guest has no device.
      groupGuestId: r.group_guest_id,
    };
  });

  let viewerGaveKudos = false;
  // D-18: a rider can also close the prompt without giving kudos. That decline is recorded on their
  // trip_rider row, so the prompt stays cleared on every device rather than only where it was
  // dismissed.
  let viewerDeclinedKudos = false;
  if (trip.status === "closed" && trip.driver_id !== user.id) {
    const [{ data: existingKudos }, { data: seat }] = await Promise.all([
      supabase.from("kudos").select("id").eq("trip_id", id).eq("from_profile_id", user.id).maybeSingle(),
      supabase
        .from("trip_rider")
        .select("kudos_declined_at")
        .eq("trip_id", id)
        .eq("profile_id", user.id)
        .eq("state", "confirmed")
        .maybeSingle(),
    ]);
    viewerGaveKudos = !!existingKudos;
    viewerDeclinedKudos = !!seat?.kudos_declined_at;
  }

  // D-38: the viewer's own seat was waived by an edit, so leaving costs them nothing. Read off the
  // rider rows already fetched above rather than a second query.
  const viewerSeat = (riderRows ?? []).find((r) => r.profile_id === user.id);
  const penaltyWaived = !!viewerSeat?.penalty_waived_at;

  // D-24: the driver's passenger picker. Group members who aren't already on this trip, resolved
  // here rather than in a second round trip so the client never has to ask "who is in my group" —
  // a question RLS should answer on the server.
  const isDriver = trip.driver_id === user.id;
  let addableMembers: { id: string; name: string; initials: string; color: string }[] = [];
  if (isDriver && (trip.status === "scheduled" || trip.status === "started")) {
    const { data: memberships } = await supabase
      .from("membership")
      .select("profile_id")
      .eq("group_id", trip.group_id);
    const seated = new Set(
      (riderRows ?? []).map((r) => r.profile_id).filter((v): v is string => !!v),
    );
    const candidateIds = (memberships ?? [])
      .map((m) => m.profile_id)
      .filter((pid) => pid !== trip.driver_id && !seated.has(pid));
    if (candidateIds.length > 0) {
      const { data: candidates } = await supabase
        .from("profile")
        .select("id, display_name, initials, avatar_color")
        .in("id", candidateIds)
        .order("display_name", { ascending: true });
      addableMembers = (candidates ?? []).map((c) => ({
        id: c.id,
        name: c.display_name,
        initials: c.initials ?? "?",
        color: c.avatar_color ?? "var(--purple)",
      }));
    }
  }

  // D-38: everything the edit form needs to open already filled in — the raw instants and ids the
  // decorated view has formatted away, plus the group's stop list. Same reasoning as
  // addableMembers: the client should not have to assemble a picture the server already has.
  let editable: {
    departAt: string;
    returnAt: string | null;
    capacity: number;
    direction: string;
    outStopId: string | null;
    backStopId: string | null;
    stops: TripStopView[];
  } | null = null;
  if (isDriver && trip.status === "scheduled") {
    const { data: groupStops } = await supabase
      .from("pickup_place")
      .select("id, label, icon, address")
      .eq("group_id", trip.group_id)
      .eq("kind", "stop")
      .order("sort_order", { ascending: true });
    editable = {
      departAt: trip.depart_at,
      returnAt: trip.return_at,
      capacity: trip.capacity,
      direction: trip.direction,
      outStopId: trip.out_stop_id,
      backStopId: trip.back_stop_id,
      stops: (groupStops ?? []).map(stopView).filter((s): s is TripStopView => s !== null),
    };
  }

  // D-54: driver-only, and gated on the server rather than hidden in the client. A rider never
  // receives the URL at all, so "who sees the parking link" is answered by what leaves the machine
  // instead of by which branch of JSX runs.
  const parkingUrl = isDriver
    ? parkingUrlForLeg(trip.direction, {
        parkingUrlOut: group.parking_url_out,
        parkingUrlBack: group.parking_url_back,
      })
    : null;

  // D-55: the guests the driver can still seat — this group's roster minus anyone already aboard.
  // Assembled here for the same reason as addableMembers just above, and gated the same way:
  // only the driver of a live trip is offered the list.
  let addableGuests: { id: string; name: string; initials: string; color: string }[] = [];
  if (isDriver && (trip.status === "scheduled" || trip.status === "started")) {
    const roster = await loadGuestRoster(supabase, trip.group_id);
    if (roster.ok) {
      const seatedGuestIds = new Set(
        (riderRows ?? []).map((r) => r.group_guest_id).filter((v): v is string => !!v),
      );
      addableGuests = roster.guests
        .filter((g) => !seatedGuestIds.has(g.id))
        .map((g) => ({ id: g.id, name: g.displayName, initials: g.initials, color: g.color }));
    }
  }

  return NextResponse.json({
    trip: decorateTrip(view),
    driverId: trip.driver_id,
    isDriver,
    parkingUrl,
    cancelledReason: trip.cancelled_reason,
    pickups,
    addableMembers,
    addableGuests,
    seatsLeft: trip.capacity - (riderRows ?? []).length,
    viewerGaveKudos,
    viewerDeclinedKudos,
    penaltyWaived,
    editable,
  });
}

// PATCH /api/trips/:id — driver-only, and only while the trip is still scheduled (a started/closed
// trip's plan is fixed).
const patchSchema = z
  .object({
    departAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be a valid date/time"),
    returnAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be a valid date/time").nullable(),
    capacity: z.number().int().min(SEATS.min).max(SEATS.max),
    // D-29: nullable so a driver can clear a stop, not only change it.
    outStopId: z.string().uuid().nullable(),
    backStopId: z.string().uuid().nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "At least one field is required");

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: trip } = await supabase
    .from("trip")
    .select("driver_id, status, direction, group_id, depart_at, return_at, capacity, out_stop_id, back_stop_id")
    .eq("id", id)
    .maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (trip.driver_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (trip.status !== "scheduled") {
    return NextResponse.json({ error: "wrong_status", message: "Only a scheduled trip can be edited." }, { status: 409 });
  }

  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }
  if (parsed.data.returnAt !== undefined && trip.direction !== "round" && parsed.data.returnAt !== null) {
    return NextResponse.json(
      { error: "invalid_request", message: "returnAt only applies to round trips" },
      { status: 400 },
    );
  }

  // D-47: only a field actually being set can newly violate the schedule — an already-departed
  // trip is allowed to have its capacity or stops edited (D-23), just not its departure re-set into
  // the past.
  if (parsed.data.departAt !== undefined && isDepartureInPast(parsed.data.departAt, new Date())) {
    return NextResponse.json(
      { error: "invalid_request", message: "Departure time can't be in the past." },
      { status: 400 },
    );
  }
  if (parsed.data.departAt !== undefined || parsed.data.returnAt !== undefined) {
    const effectiveDepartAt = parsed.data.departAt ?? trip.depart_at;
    const effectiveReturnAt = parsed.data.returnAt !== undefined ? parsed.data.returnAt : trip.return_at;
    if (effectiveReturnAt && isReturnBeforeDeparture(effectiveDepartAt, effectiveReturnAt)) {
      return NextResponse.json(
        { error: "invalid_request", message: "Return time must be after departure." },
        { status: 400 },
      );
    }
  }

  if (parsed.data.outStopId !== undefined && trip.direction === "back") {
    return NextResponse.json(
      { error: "invalid_request", message: "outStopId only applies to a trip with an outbound leg" },
      { status: 400 },
    );
  }
  if (parsed.data.backStopId !== undefined && trip.direction === "out") {
    return NextResponse.json(
      { error: "invalid_request", message: "backStopId only applies to a trip with a return leg" },
      { status: 400 },
    );
  }

  // Read through the session client so RLS confirms the driver can actually see the place they are
  // naming — a stop must come from their own group's list (D-29).
  const stops = await resolveTripStops(
    supabase,
    trip.group_id,
    trip.direction,
    parsed.data.outStopId,
    parsed.data.backStopId,
  );
  if (!stops.ok) {
    return stops.error === "unknown_stop"
      ? NextResponse.json({ error: "unknown_stop", message: "That stop isn't on this group's list." }, { status: 400 })
      : NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  // Riders already aboard, read before the update so the waiver and the notification address
  // exactly the people who agreed to the *old* plan. Someone joining after this point is agreeing
  // to the new one (D-38).
  const { data: activeRiders } = await supabase
    .from("trip_rider")
    .select("id, profile_id")
    .eq("trip_id", id)
    .in("state", ["joined", "confirmed"]);
  const seatedCount = (activeRiders ?? []).length;

  // Seats can be added or taken back, but not below the people already in the car — there is no
  // rule for which of them would lose their seat, and inventing one is not this route's call.
  if (parsed.data.capacity !== undefined && parsed.data.capacity < seatedCount) {
    return NextResponse.json(
      {
        error: "capacity_below_riders",
        message: `${seatedCount} ${seatedCount === 1 ? "person is" : "people are"} already riding — remove a passenger before cutting seats.`,
      },
      { status: 409 },
    );
  }

  // What actually changed, compared against what is stored — not merely what the body mentioned.
  // Resaving the form untouched must not notify five people or hand out a free drop-out.
  const diff = diffTripEdit(
    {
      departAt: trip.depart_at,
      returnAt: trip.return_at,
      capacity: trip.capacity,
      outStopId: trip.out_stop_id,
      backStopId: trip.back_stop_id,
    },
    {
      ...(parsed.data.departAt !== undefined && { departAt: parsed.data.departAt }),
      ...(parsed.data.returnAt !== undefined && { returnAt: parsed.data.returnAt }),
      ...(parsed.data.capacity !== undefined && { capacity: parsed.data.capacity }),
      ...(parsed.data.outStopId !== undefined && { outStopId: stops.outStopId }),
      ...(parsed.data.backStopId !== undefined && { backStopId: stops.backStopId }),
    },
  );

  if (diff.changed.length === 0) {
    const { data: unchanged } = await supabase.from("trip").select("*").eq("id", id).single();
    return NextResponse.json({ trip: unchanged, changed: [], notifiedRiders: 0 });
  }

  const admin = createSupabaseAdminClient();
  const { data: updated, error } = await admin
    .from("trip")
    .update({
      ...(parsed.data.departAt !== undefined && { depart_at: parsed.data.departAt }),
      ...(parsed.data.returnAt !== undefined && { return_at: parsed.data.returnAt }),
      ...(parsed.data.capacity !== undefined && { capacity: parsed.data.capacity }),
      ...(parsed.data.outStopId !== undefined && { out_stop_id: stops.outStopId }),
      ...(parsed.data.backStopId !== undefined && { back_stop_id: stops.backStopId }),
    })
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "update_failed", message: error?.message }, { status: 500 });
  }

  // A rider who joined a direct ride needs to know it now detours, just as much as they need to
  // know the time moved (D-29) — and either way the ride they booked is no longer the ride they
  // have, so their seat stops carrying the late-cancellation charge (D-38).
  let notifiedRiders = 0;
  if (diff.material && diff.notice) {
    const seatIds = (activeRiders ?? []).map((r) => r.id);
    if (seatIds.length > 0) {
      // The waiver is written before the notification: a rider who acts on the push the instant it
      // lands must find the free drop-out already in force, not a race with it.
      const { error: waiveError } = await admin
        .from("trip_rider")
        .update({ penalty_waived_at: new Date().toISOString() })
        .in("id", seatIds);
      if (waiveError) {
        return NextResponse.json({ error: "waiver_failed", message: waiveError.message }, { status: 500 });
      }
    }

    const riderProfileIds = (activeRiders ?? []).map((r) => r.profile_id).filter((pid): pid is string => !!pid);
    await notifyProfiles(riderProfileIds, { type: "change", ...diff.notice, tripId: id });
    notifiedRiders = riderProfileIds.length;
  }

  return NextResponse.json({ trip: updated, changed: diff.changed, notifiedRiders });
}
