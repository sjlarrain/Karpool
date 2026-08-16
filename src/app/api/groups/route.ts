import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { generateGroupCode } from "@/domain/groupCode";

// GET /api/groups — groups the caller belongs to.
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("membership")
    .select("group_id, group_role")
    .eq("profile_id", user.id);

  if (membershipError) {
    return NextResponse.json({ error: "membership_lookup_failed" }, { status: 500 });
  }

  const groupIds = (memberships ?? []).map((m) => m.group_id);
  const { data: groups, error: groupsError } =
    groupIds.length > 0
      ? await supabase.from("group").select("id, name, origin_label, dest_label, code").in("id", groupIds)
      : { data: [], error: null };

  if (groupsError) {
    return NextResponse.json({ error: "group_lookup_failed" }, { status: 500 });
  }

  const roleByGroupId = new Map((memberships ?? []).map((m) => [m.group_id, m.group_role]));
  return NextResponse.json({
    groups: (groups ?? []).map((g) => ({ ...g, role: roleByGroupId.get(g.id) ?? "member" })),
  });
}

// POST /api/groups — create a group. Creator becomes group_admin.
const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  originLabel: z.string().trim().min(1).max(80),
  destLabel: z.string().trim().min(1).max(80),
  costSplitNote: z.string().trim().max(200).optional(), // D-08: static per-group text
});

async function generateUniqueCode(admin: ReturnType<typeof createSupabaseAdminClient>) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateGroupCode();
    const { data } = await admin.from("group").select("id").eq("code", code).maybeSingle();
    if (!data) return code;
  }
  throw new Error("Could not generate a unique group code after 10 attempts");
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = createGroupSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const code = await generateUniqueCode(admin);

  const { data: group, error: groupError } = await admin
    .from("group")
    .insert({
      name: parsed.data.name,
      origin_label: parsed.data.originLabel,
      dest_label: parsed.data.destLabel,
      cost_split_note: parsed.data.costSplitNote ?? null,
      code,
      created_by: user.id,
    })
    .select()
    .single();

  if (groupError || !group) {
    return NextResponse.json({ error: "group_create_failed", message: groupError?.message }, { status: 500 });
  }

  const { error: membershipError } = await admin
    .from("membership")
    .insert({ group_id: group.id, profile_id: user.id, group_role: "group_admin" });

  if (membershipError) {
    return NextResponse.json({ error: "membership_create_failed", message: membershipError.message }, { status: 500 });
  }

  return NextResponse.json({ group, role: "group_admin" as const }, { status: 201 });
}
