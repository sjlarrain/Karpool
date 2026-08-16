import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profile")
    .select("id, display_name, initials, avatar_color, platform_role")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json({ error: "profile_missing" }, { status: 500 });
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("membership")
    .select("group_id, group_role")
    .eq("profile_id", userData.user.id);

  if (membershipError) {
    return NextResponse.json({ error: "membership_lookup_failed" }, { status: 500 });
  }

  const groupIds = (memberships ?? []).map((m) => m.group_id);
  const { data: groups, error: groupsError } =
    groupIds.length > 0
      ? await supabase.from("group").select("id, name, code").in("id", groupIds)
      : { data: [], error: null };

  if (groupsError) {
    return NextResponse.json({ error: "group_lookup_failed" }, { status: 500 });
  }

  const roleByGroupId = new Map((memberships ?? []).map((m) => [m.group_id, m.group_role]));
  const groupsWithRole = (groups ?? []).map((g) => ({ ...g, role: roleByGroupId.get(g.id) ?? "member" }));

  return NextResponse.json({
    user: { id: userData.user.id, email: userData.user.email },
    profile,
    groups: groupsWithRole,
    hasGroup: groupsWithRole.length > 0,
  });
}
