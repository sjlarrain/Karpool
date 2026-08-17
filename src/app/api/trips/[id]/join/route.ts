import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/rateLimit";

const STATUS_BY_ERROR: Record<string, number> = {
  trip_not_found: 404,
  is_driver: 409,
  wrong_status: 409,
  already_joined: 409,
  full: 409,
};

const MESSAGE_BY_ERROR: Record<string, string> = {
  is_driver: "You're driving this trip.",
  wrong_status: "This trip isn't open to join.",
  already_joined: "You're already riding this trip.",
  full: "That trip just filled up.",
};

// POST /api/trips/:id/join — join an open seat. Calls join_trip() (supabase/migrations/0002),
// a Postgres function that locks the trip row for the duration of the capacity check + insert, so
// two riders racing for the last seat produce exactly one winner (G4-adjacent correctness, not a
// count-then-insert race in application code). No ledger writes here — pooled points are awarded
// on close (Phase 4's close flow), not on join.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // RLS (is_member) makes this null for a non-member, giving the same 404 as a truly missing trip.
  const { data: trip } = await supabase.from("trip").select("id").eq("id", id).maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = createSupabaseAdminClient();

  const { allowed } = await checkRateLimit(admin, user.id, "trip_join", 20, 600);
  if (!allowed) {
    return NextResponse.json({ error: "rate_limited", message: "Too many join attempts — try again in a bit." }, { status: 429 });
  }

  const { data: joined, error } = await admin.rpc("join_trip", { p_trip_id: id, p_profile_id: user.id });

  if (error || !joined) {
    const code = error?.message ?? "join_failed";
    const status = STATUS_BY_ERROR[code] ?? 500;
    return NextResponse.json({ error: code, message: MESSAGE_BY_ERROR[code] }, { status });
  }

  return NextResponse.json({ tripRider: joined }, { status: 201 });
}
