import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isValidGroupCodeFormat, normalizeGroupCode } from "@/domain/groupCode";
import type { Database } from "@/types/database";

// The last line of defence for a shared invite link.
//
// A visitor who clicks /j/CODE while signed out signs up, and the group they picked has to survive
// a round trip through an email. Two carriers already exist for that: `?next=/j/CODE` on the
// confirmation link, and `user_metadata.pending_group_code` as the belt to that braces. Both are
// only ever read by GET /auth/callback — which means both are lost together the moment the
// confirmation link does not land on /auth/callback at all. That is not hypothetical: if the
// Supabase project's Site URL and redirect allow-list do not include the deployed origin, Supabase
// refuses the `emailRedirectTo` we ask for and sends the visitor to the Site URL instead. They
// arrive signed in, with no membership, get bounced to the locked screen, and are asked to type a
// code they never had — while the code they clicked sits in their own user metadata, unread.
//
// So the redemption is moved to where the failure actually shows up: any authenticated request that
// finds no membership. That makes the invite independent of which URL the email happened to use.
//
// Idempotent and quiet by design — it runs on every group-less page load, so it must be safe to
// call when there is nothing to redeem, and it must never turn a bad stored code into an error the
// visitor has to read. Returns the group id when a join happened, null otherwise.
export async function redeemPendingInvite(user: User): Promise<string | null> {
  const pending = user.user_metadata?.pending_group_code;
  if (typeof pending !== "string") return null;

  const code = normalizeGroupCode(pending);
  if (!isValidGroupCodeFormat(code)) return null;

  const admin = createSupabaseAdminClient();
  const { data: group } = await admin.from("group").select("id").eq("code", code).maybeSingle();
  // The group was renamed or removed while the invite sat in an inbox. Clear the code so this
  // lookup does not repeat on every page load forever.
  if (!group) {
    await clearPendingCode(admin, user.id);
    return null;
  }

  const { data: existing } = await admin
    .from("membership")
    .select("id")
    .eq("group_id", group.id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!existing) {
    const { error } = await admin
      .from("membership")
      .insert({ group_id: group.id, profile_id: user.id, group_role: "member" });
    // A failed insert leaves the code in place: the next page load tries again, which is the right
    // outcome for a transient failure and harmless for a permanent one.
    if (error) return null;
  }

  // Redeemed. Clearing it keeps a later departure from the group from silently re-joining them.
  await clearPendingCode(admin, user.id);
  return group.id;
}

async function clearPendingCode(admin: SupabaseClient<Database>, userId: string): Promise<void> {
  await admin.auth.admin.updateUserById(userId, { user_metadata: { pending_group_code: null } });
}
