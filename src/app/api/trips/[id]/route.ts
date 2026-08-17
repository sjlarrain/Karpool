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
      .select("id, profile_id, guest_name, pickup_place_id, stop_order, state")
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
    };
  });

  return NextResponse.json({
    trip: decorateTrip(view),
    driverId: trip.driver_id,
    isDriver: trip.driver_id === user.id,
    cancelledReason: trip.cancelled_reason,
    pickups,
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
