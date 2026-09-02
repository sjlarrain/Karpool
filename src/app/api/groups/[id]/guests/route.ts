import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/audit";
import { loadGuestRoster } from "@/lib/groups/guestRoster";

// D-55: the group's guest roster — the people who ride without an account, given a stable identity
// so their rides accumulate under one name instead of scattering across free-text spellings.
//
// GET is member-visible: a driver needs the list to seat someone. The mutations below are
// group_admin only, following D-29's rule for the other admin-managed list in this app ("the place
// list stays manager-managed and fixed — tags can be overpopulated"). The close screen's free-text
// field is deliberately left in place for a genuine one-off, and stays uncounted exactly as before.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // RLS (is_member) would already return nothing for a non-member, but an explicit membership check
  // gives the same 404 as every other group route rather than an empty list that reads as "no
  // guests yet" to someone who isn't in the group at all.
  const { data: membership } = await supabase
    .from("membership")
    .select("group_role")
    .eq("group_id", id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const roster = await loadGuestRoster(supabase, id);
  if (!roster.ok) {
    return NextResponse.json({ error: roster.error }, { status: 500 });
  }

  return NextResponse.json({ guests: roster.guests, canManage: membership.group_role === "group_admin" });
}

const createSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: guest, error } = await admin
    .from("group_guest")
    .insert({ group_id: id, display_name: parsed.data.displayName, created_by: user.id })
    .select("id, display_name, claimed_by_profile_id, claimed_at, created_at")
    .single();

  if (error || !guest) {
    // 23505 is the unique index on (group_id, lower(trim(display_name))) — the constraint that makes
    // the roster an identity rather than a list of strings. A duplicate is a normal thing for an
    // admin to try, so it gets a sentence rather than a 500.
    if (error?.code === "23505") {
      return NextResponse.json(
        { error: "already_exists", message: "There's already a guest with that name in this group." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "create_failed", message: error?.message }, { status: 500 });
  }

  await writeAuditLog(admin, {
    actorProfileId: user.id,
    action: "group_guest_added",
    entityType: "group_guest",
    entityId: guest.id,
    after: { groupId: id, displayName: guest.display_name },
    request,
  });

  return NextResponse.json({ guest: { ...guest, rides: 0, claimedBy: null } }, { status: 201 });
}
