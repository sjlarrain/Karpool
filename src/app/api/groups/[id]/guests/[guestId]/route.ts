import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/audit";

// DELETE /api/groups/:id/guests/:guestId — remove a guest from the roster. group_admin only.
//
// Refused while the guest holds any seat, past or present. The column is `on delete set null`, so
// the database would happily orphan those seats into plain named guests — which is the safe failure
// mode, not the intended one: the rides would silently stop being claimable, and the person they
// belong to would lose a history nobody meant to discard. Deleting is for a name typed in error.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; guestId: string }> }) {
  const { id, guestId } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("membership")
    .select("group_role")
    .eq("group_id", id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (membership.group_role !== "group_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: guest } = await supabase
    .from("group_guest")
    .select("id, display_name")
    .eq("id", guestId)
    .eq("group_id", id)
    .maybeSingle();
  if (!guest) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { count, error: seatError } = await supabase
    .from("trip_rider")
    .select("id", { count: "exact", head: true })
    .eq("group_guest_id", guestId);
  // A failed count must not read as "no seats" — that is how a delete guard becomes decorative.
  if (seatError) {
    return NextResponse.json({ error: "seat_lookup_failed", message: seatError.message }, { status: 500 });
  }
  const rides = count ?? 0;
  if (rides > 0) {
    return NextResponse.json(
      {
        error: "has_rides",
        message: `${guest.display_name} has ${rides} ride${rides === 1 ? "" : "s"} on record — link them to a member instead of deleting.`,
      },
      { status: 409 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("group_guest").delete().eq("id", guestId);
  if (error) {
    return NextResponse.json({ error: "delete_failed", message: error.message }, { status: 500 });
  }

  await writeAuditLog(admin, {
    actorProfileId: user.id,
    action: "group_guest_deleted",
    entityType: "group_guest",
    entityId: guestId,
    before: { groupId: id, displayName: guest.display_name },
    request,
  });

  return NextResponse.json({ ok: true });
}
