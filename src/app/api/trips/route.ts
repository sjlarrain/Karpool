import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { SEATS } from "@/domain/constants";
import { loadGroupTrips } from "@/lib/trips/loadGroupTrips";

// GET /api/trips?groupId=&scope=all|mine — live trip feed for a group (scheduled/started only;
// closed and cancelled trips don't appear in the Carpools tab feed).
export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const groupId = url.searchParams.get("groupId");
  const scope = url.searchParams.get("scope") === "mine" ? "mine" : "all";
  if (!groupId) {
    return NextResponse.json({ error: "invalid_request", message: "groupId is required" }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("membership")
    .select("id")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await loadGroupTrips(supabase, groupId, user.id, new Date());
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 500 });
  }

  const scoped = scope === "mine" ? result.trips.filter((t) => t.role === "driving" || t.role === "joined") : result.trips;
  return NextResponse.json({ trips: scoped });
}

// POST /api/trips — driver publishes a trip. Caller must be a member of the group; the route pays
// the group's route as the source of origin/dest (never invented by the trip, per §3.1 of the plan).
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be a valid date/time");

const createTripSchema = z
  .object({
    groupId: z.string().uuid(),
    direction: z.enum(["out", "back", "round"]),
    departAt: isoDate,
    returnAt: isoDate.optional(),
    capacity: z.number().int().min(SEATS.min).max(SEATS.max),
  })
  .refine((data) => (data.direction === "round" ? !!data.returnAt : !data.returnAt), {
    message: "returnAt is required for round trips and not allowed otherwise",
    path: ["returnAt"],
  });

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = createTripSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("membership")
    .select("id")
    .eq("group_id", parsed.data.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();
  const { data: trip, error } = await admin
    .from("trip")
    .insert({
      group_id: parsed.data.groupId,
      driver_id: user.id,
      direction: parsed.data.direction,
      depart_at: parsed.data.departAt,
      return_at: parsed.data.returnAt ?? null,
      capacity: parsed.data.capacity,
    })
    .select()
    .single();

  if (error || !trip) {
    return NextResponse.json({ error: "trip_create_failed", message: error?.message }, { status: 500 });
  }

  return NextResponse.json({ trip }, { status: 201 });
}
