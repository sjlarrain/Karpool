import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/audit";

// D-55, the merge itself: link a roster guest to the member who turns out to be that person.
//
// One UPDATE on one row, and every seat that guest has ever held immediately counts for the member
// — the leaderboard and the YOU tab both resolve a seat through this column rather than storing a
// resolved owner. That is also why it is reversible: DELETE below unlinks it and the rides go back
// where they were, which re-pointing a pile of trip_rider rows would never have allowed.
//
// group_admin only, the developer's choice over letting a newcomer claim a name for themselves. It
// moves someone else's ride history onto an account, so both directions are audit-logged with the
// admin who did it.

const claimSchema = z.object({
  profileId: z.string().uuid(),
});

async function authorize(groupId: string, guestId: string) {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) } as const;
  }

  const { data: membership } = await supabase
    .from("membership")
    .select("group_role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!membership) {
    return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) } as const;
  }
  if (membership.group_role !== "group_admin") {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) } as const;
  }

  const { data: guest } = await supabase
    .from("group_guest")
    .select("id, display_name, claimed_by_profile_id")
    .eq("id", guestId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (!guest) {
    return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) } as const;
  }

  return { supabase, user, guest } as const;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; guestId: string }> }) {
  const { id, guestId } = await params;
  const auth = await authorize(id, guestId);
  if ("error" in auth) return auth.error;
  const { supabase, user, guest } = auth;

  const json = await request.json().catch(() => null);
  const parsed = claimSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  if (guest.claimed_by_profile_id) {
    return NextResponse.json(
      { error: "already_claimed", message: `${guest.display_name} is already linked to a member.` },
      { status: 409 },
    );
  }

  // The claimant must be in this group. Linking a guest to someone outside it would put rides taken
  // here onto a leaderboard they do not appear on — the leaderboard builds its rows from
  // membership — so the rides would vanish rather than move.
  const { data: target } = await supabase
    .from("membership")
    .select("profile_id")
    .eq("group_id", id)
    .eq("profile_id", parsed.data.profileId)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: "not_a_member", message: "That person is not in this group." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: updated, error } = await admin
    .from("group_guest")
    .update({
      claimed_by_profile_id: parsed.data.profileId,
      claimed_at: new Date().toISOString(),
      claimed_by_admin_id: user.id,
    })
    .eq("id", guestId)
    // Compare-and-swap on the claim: two admins linking the same guest to two different members at
    // the same moment would otherwise both succeed, and the loser's decision would be overwritten
    // with no sign that it had happened.
    .is("claimed_by_profile_id", null)
    .select("id, display_name, claimed_by_profile_id, claimed_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "claim_failed", message: error.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: "already_claimed", message: `${guest.display_name} was just linked by someone else.` },
      { status: 409 },
    );
  }

  await writeAuditLog(admin, {
    actorProfileId: user.id,
    action: "group_guest_claimed",
    entityType: "group_guest",
    entityId: guestId,
    before: { claimedByProfileId: null },
    after: { groupId: id, displayName: guest.display_name, claimedByProfileId: parsed.data.profileId },
    request,
  });

  return NextResponse.json({ guest: updated });
}

// Undo. The rides go back to the guest and off the member's line — the same single column, the
// other way, which is what makes this safe for an admin to get wrong.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; guestId: string }> }) {
  const { id, guestId } = await params;
  const auth = await authorize(id, guestId);
  if ("error" in auth) return auth.error;
  const { user, guest } = auth;

  if (!guest.claimed_by_profile_id) {
    return NextResponse.json({ error: "not_claimed", message: "That guest is not linked to anyone." }, { status: 409 });
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("group_guest")
    .update({ claimed_by_profile_id: null, claimed_at: null, claimed_by_admin_id: null })
    .eq("id", guestId);
  if (error) {
    return NextResponse.json({ error: "unclaim_failed", message: error.message }, { status: 500 });
  }

  await writeAuditLog(admin, {
    actorProfileId: user.id,
    action: "group_guest_unclaimed",
    entityType: "group_guest",
    entityId: guestId,
    before: { groupId: id, displayName: guest.display_name, claimedByProfileId: guest.claimed_by_profile_id },
    after: { claimedByProfileId: null },
    request,
  });

  return NextResponse.json({ ok: true });
}
