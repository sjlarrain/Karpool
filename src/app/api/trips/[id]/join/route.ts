import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";

// POST /api/trips/:id/join — join an open seat. Phase 3 scope: a straightforward capacity check
// then insert; Phase 4 ("feat(points)") replaces this with the capacity-checked, transactional
// version that closes the race between two riders claiming the last seat, plus the pooled-points
// ledger entry. No ledger writes happen here yet.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: trip } = await supabase.from("trip").select("driver_id, status, capacity").eq("id", id).maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (trip.driver_id === user.id) {
    return NextResponse.json({ error: "is_driver", message: "You're driving this trip." }, { status: 409 });
  }
  if (trip.status !== "scheduled") {
    return NextResponse.json({ error: "wrong_status", message: "This trip isn't open to join." }, { status: 409 });
  }

  const { data: activeRiders, error: ridersError } = await supabase
    .from("trip_rider")
    .select("id, profile_id, state")
    .eq("trip_id", id)
    .in("state", ["joined", "confirmed"]);
  if (ridersError) {
    return NextResponse.json({ error: "rider_lookup_failed" }, { status: 500 });
  }

  if ((activeRiders ?? []).some((r) => r.profile_id === user.id)) {
    return NextResponse.json({ error: "already_joined" }, { status: 409 });
  }
  if ((activeRiders ?? []).length >= trip.capacity) {
    return NextResponse.json({ error: "full" }, { status: 409 });
  }

  const admin = createSupabaseAdminClient();
  const { data: joined, error } = await admin
    .from("trip_rider")
    .insert({ trip_id: id, profile_id: user.id, state: "joined" })
    .select()
    .single();

  if (error || !joined) {
    // 23505 = unique_violation — trip_rider_one_active_seat caught a race the count-check missed.
    if (error?.code === "23505") {
      return NextResponse.json({ error: "already_joined" }, { status: 409 });
    }
    return NextResponse.json({ error: "join_failed", message: error?.message }, { status: 500 });
  }

  return NextResponse.json({ tripRider: joined }, { status: 201 });
}
