import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";

// POST /api/trips/:id/kudos/decline — the "no thanks" half of the kudos prompt (D-18). Kudos stays
// binary and one-per-rider-per-trip; this records that the rider closed the prompt without giving
// any, so it stays cleared on every device instead of reappearing on the next load.
//
// Deliberately writes nothing to `kudos` and nothing to `points_ledger`: a decline is the absence
// of kudos, not a kind of kudos. Idempotent — declining twice is still a 200.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: trip } = await supabase.from("trip").select("id, status, driver_id").eq("id", id).maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (trip.status !== "closed") {
    return NextResponse.json({ error: "wrong_status", message: "You can only rate a closed trip." }, { status: 409 });
  }
  if (trip.driver_id === user.id) {
    return NextResponse.json({ error: "is_driver", message: "The driver has no kudos prompt to dismiss." }, { status: 409 });
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
      { error: "not_confirmed_rider", message: "Only riders confirmed on this trip have a kudos prompt." },
      { status: 403 },
    );
  }

  // A rider who already gave kudos has no prompt left to decline — say so rather than recording a
  // decline that contradicts an existing kudos row.
  const { data: existingKudos } = await supabase
    .from("kudos")
    .select("id")
    .eq("trip_id", id)
    .eq("from_profile_id", user.id)
    .maybeSingle();
  if (existingKudos) {
    return NextResponse.json({ error: "already_given" }, { status: 409 });
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("trip_rider")
    .update({ kudos_declined_at: new Date().toISOString() })
    .eq("id", seat.id);

  if (error) {
    return NextResponse.json({ error: "decline_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ declined: true });
}
