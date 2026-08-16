import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { isValidGroupCodeFormat, normalizeGroupCode } from "@/domain/groupCode";

// POST /api/groups/join — join by code. A non-member can't read the group row via RLS (is_member
// gates it), so the lookup has to go through the admin client — same D-04 shape as every other
// write here: authenticate with the session client, act with the service-role client.
const bodySchema = z.object({ code: z.string().min(1) });

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const code = normalizeGroupCode(parsed.data.code);
  if (!isValidGroupCodeFormat(code)) {
    // Invalid code -> a clear error, never a silent no-op (Phase 2 rule).
    return NextResponse.json({ error: "invalid_code", message: "That code doesn't look right." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: group, error: groupError } = await admin
    .from("group")
    .select("id, name, origin_label, dest_label, code")
    .eq("code", code)
    .maybeSingle();

  if (groupError) {
    return NextResponse.json({ error: "group_lookup_failed" }, { status: 500 });
  }
  if (!group) {
    return NextResponse.json({ error: "invalid_code", message: "No group has that code." }, { status: 404 });
  }

  const { data: existing } = await admin
    .from("membership")
    .select("id, group_role")
    .eq("group_id", group.id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ group, role: existing.group_role, alreadyMember: true });
  }

  const { data: membership, error: membershipError } = await admin
    .from("membership")
    .insert({ group_id: group.id, profile_id: user.id, group_role: "member" })
    .select()
    .single();

  if (membershipError || !membership) {
    return NextResponse.json({ error: "join_failed", message: membershipError?.message }, { status: 500 });
  }

  return NextResponse.json({ group, role: membership.group_role, alreadyMember: false }, { status: 201 });
}
