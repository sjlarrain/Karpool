import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { env } from "@/env";

// GET /api/groups/:id — group profile screen: route, admin, cost split, code, pickup places,
// invite link. RLS (is_member) makes this 404 rather than 403 for a non-member, so it never leaks
// whether a group exists to someone outside it (plan's "404 never leaks existence across groups").
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data: group, error: groupError } = await supabase.from("group").select("*").eq("id", id).maybeSingle();
  if (groupError) {
    return NextResponse.json({ error: "group_lookup_failed" }, { status: 500 });
  }
  if (!group) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [{ data: memberships }, { data: pickupPlaces }, { data: creatorProfile }] = await Promise.all([
    supabase.from("membership").select("group_role").eq("group_id", id),
    supabase.from("pickup_place").select("*").eq("group_id", id).order("sort_order", { ascending: true }),
    supabase.from("profile").select("display_name").eq("id", group.created_by).maybeSingle(),
  ]);

  return NextResponse.json({
    group,
    memberCount: memberships?.length ?? 0,
    adminName: creatorProfile?.display_name ?? null,
    pickupPlaces: pickupPlaces ?? [],
    inviteLink: `${env.NEXT_PUBLIC_APP_URL}/j/${group.code}`,
  });
}

// PATCH /api/groups/:id — group_admin only. Not the code (regeneration is Phase 8's admin console).
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    originLabel: z.string().trim().min(1).max(80),
    destLabel: z.string().trim().min(1).max(80),
    costSplitNote: z.string().trim().max(200).nullable(),
    // D-54. https only, and enforced here as well as by the CHECK constraint on the column: this is
    // the first outbound link the app renders, an admin writes it and their colleagues follow it,
    // so javascript: and data: URLs are refused at both layers rather than one. Nullable clears it.
    parkingUrlOut: z.string().trim().url().startsWith("https://").max(500).nullable(),
    parkingUrlBack: z.string().trim().url().startsWith("https://").max(500).nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "At least one field is required");

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: updated, error: updateError } = await admin
    .from("group")
    .update({
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.originLabel !== undefined && { origin_label: parsed.data.originLabel }),
      ...(parsed.data.destLabel !== undefined && { dest_label: parsed.data.destLabel }),
      ...(parsed.data.costSplitNote !== undefined && { cost_split_note: parsed.data.costSplitNote }),
      ...(parsed.data.parkingUrlOut !== undefined && { parking_url_out: parsed.data.parkingUrlOut }),
      ...(parsed.data.parkingUrlBack !== undefined && { parking_url_back: parsed.data.parkingUrlBack }),
    })
    .eq("id", id)
    .select()
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: "update_failed", message: updateError?.message }, { status: 500 });
  }

  return NextResponse.json({ group: updated });
}
