import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { SEATS } from "@/domain/constants";
import { toTripView } from "@/domain/toTripView";
import type { TripRiderRowInput, TripRowInput } from "@/domain/toTripView";
import { decorateTrip } from "@/domain/decorateTrip";
import { notifyProfiles } from "@/lib/notify/tripNotify";

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

  const [{ data: group }, { data: driver }, { data: riderRows }] = await Promise.all([
    supabase.from("group").select("origin_label, dest_label").eq("id", trip.group_id).maybeSingle(),
    supabase.from("profile").select("id, display_name, initials, avatar_color").eq("id", trip.driver_id).maybeSingle(),
    supabase
      .from("trip_rider")
      .select("id, profile_id, guest_name, pickup_place_id, stop_order, state, added_by_profile_id")
      .eq("trip_id", id)
      .in("state", ["joined", "confirmed"])
      .order("stop_order", { ascending: true, nullsFirst: false }),
  ]);

  if (!group || !driver) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const riderProfileIds = [...new Set((riderRows ?? []).map((r) => r.profile_id).filter((v): v is string => !!v))];
  const pickupPlaceIds = [...new Set((riderRows ?? []).map((r) => r.pickup_place_id).filter((v): v is string => !!v))];

  const [{ data: riderProfiles }, { data: pickupPlaces }] = await Promise.all([
    riderProfileIds.length > 0
      ? supabase.from("profile").select("id, display_name, initials, avatar_color").in("id", riderProfileIds)
      : Promise.resolve({ data: [] }),
    pickupPlaceIds.length > 0
      ? supabase.from("pickup_place").select("id, label").in("id", pickupPlaceIds)
      : Promise.resolve({ data: [] }),
  ]);

  const riderProfileById = new Map((riderProfiles ?? []).map((p) => [p.id, p]));
  const pickupLabelById = new Map((pickupPlaces ?? []).map((p) => [p.id, p.label]));

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
  };

  const view = toTripView({
    trip: tripInput,
    driver: { id: trip.driver_id, displayName: driver.display_name },
    activeRiders,
    viewerId: user.id,
    originLabel: group.origin_label,
    destLabel: group.dest_label,
    now: new Date(),
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

  return NextResponse.json({
    trip: decorateTrip(view),
    driverId: trip.driver_id,
    isDriver,
    cancelledReason: trip.cancelled_reason,
    pickups,
    addableMembers,
    seatsLeft: trip.capacity - (riderRows ?? []).length,
    viewerGaveKudos,
    viewerDeclinedKudos,
  });
}

// PATCH /api/trips/:id — driver-only, and only while the trip is still scheduled (a started/closed
// trip's plan is fixed).
const patchSchema = z
  .object({
    departAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be a valid date/time"),
    returnAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be a valid date/time").nullable(),
    capacity: z.number().int().min(SEATS.min).max(SEATS.max),
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

  const { data: trip } = await supabase.from("trip").select("driver_id, status, direction").eq("id", id).maybeSingle();
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

  const admin = createSupabaseAdminClient();
  const { data: updated, error } = await admin
    .from("trip")
    .update({
      ...(parsed.data.departAt !== undefined && { depart_at: parsed.data.departAt }),
      ...(parsed.data.returnAt !== undefined && { return_at: parsed.data.returnAt }),
      ...(parsed.data.capacity !== undefined && { capacity: parsed.data.capacity }),
    })
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "update_failed", message: error?.message }, { status: 500 });
  }

  if (parsed.data.departAt !== undefined || parsed.data.returnAt !== undefined) {
    const { data: activeRiders } = await supabase
      .from("trip_rider")
      .select("profile_id")
      .eq("trip_id", id)
      .in("state", ["joined", "confirmed"]);
    const riderProfileIds = (activeRiders ?? []).map((r) => r.profile_id).filter((pid): pid is string => !!pid);
    await notifyProfiles(riderProfileIds, {
      type: "change",
      title: "Departure changed",
      body: "Your driver updated this trip's time — check the new details.",
      tripId: id,
    });
  }

  return NextResponse.json({ trip: updated });
}
