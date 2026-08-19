import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { computeKudosAward } from "@/domain/points";

const bodySchema = z.object({ comment: z.string().trim().max(500).optional() });

// POST /api/trips/:id/kudos — binary kudos (you give it or you don't — calling this endpoint at
// all IS the "give" action; there's no body flag for "I chose not to"). Only a confirmed registered
// rider on a closed trip can give kudos, and only once per trip (kudos' unique(trip_id,
// from_profile_id) constraint is the backstop). Awards the driver kudos_weight points.
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

  const { data: trip } = await supabase.from("trip").select("id, status, driver_id, group_id").eq("id", id).maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (trip.status !== "closed") {
    return NextResponse.json({ error: "wrong_status", message: "You can only rate a closed trip." }, { status: 409 });
  }
  if (trip.driver_id === user.id) {
    return NextResponse.json({ error: "is_driver", message: "You can't give yourself kudos." }, { status: 409 });
  }

  const { data: seat } = await supabase
    .from("trip_rider")
    .select("id")
    .eq("trip_id", id)
    .eq("profile_id", user.id)
    .eq("state", "confirmed")
    .maybeSingle();
  if (!seat) {
    return NextResponse.json(
      { error: "not_confirmed_rider", message: "Only riders confirmed on this trip can give kudos." },
      { status: 403 },
    );
  }

  const { data: group } = await supabase.from("group").select("kudos_weight").eq("id", trip.group_id).maybeSingle();
  if (!group) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();

  const { allowed } = await checkRateLimit(admin, user.id, "kudos", 20, 3600);
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited", message: "Too many kudos attempts — try again in a bit." }, { status: 429 });
  }

  const { data: kudos, error } = await admin
    .from("kudos")
    .insert({
      trip_id: id,
      from_profile_id: user.id,
      to_profile_id: trip.driver_id,
      comment: parsed.data.comment ?? null,
    })
    .select()
    .single();

  if (error || !kudos) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "already_given" }, { status: 409 });
    }
    return NextResponse.json({ error: "kudos_failed", message: error?.message }, { status: 500 });
  }

  // D-19: a kudos is worth more on a fuller car. Count the confirmed riders on this trip (guests
  // included — they count toward pooling everywhere else too) and scale the award by it.
  const { count: confirmedRiderCount } = await admin
    .from("trip_rider")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", id)
    .eq("state", "confirmed");

  const award = computeKudosAward(group.kudos_weight, confirmedRiderCount ?? 1);

  await admin.from("points_ledger").insert({
    profile_id: trip.driver_id,
    group_id: trip.group_id,
    trip_id: id,
    kind: award.kind,
    points: award.points,
    reason: award.reason,
  });

  return NextResponse.json({ kudos }, { status: 201 });
}
