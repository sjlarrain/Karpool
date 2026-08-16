import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";

// PATCH /api/memberships/:id — a member can set their own pickup_place_id; changing group_role
// requires the caller to already be a group_admin of that membership's group (plan §5).
const bodySchema = z
  .object({
    pickupPlaceId: z.string().uuid().nullable(),
    groupRole: z.enum(["member", "group_admin"]),
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

  const { data: target } = await supabase
    .from("membership")
    .select("id, group_id, profile_id")
    .eq("id", id)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  if (parsed.data.pickupPlaceId !== undefined && target.profile_id !== user.id) {
    return NextResponse.json({ error: "forbidden", message: "You can only set your own pickup place." }, { status: 403 });
  }

  if (parsed.data.groupRole !== undefined) {
    const { data: callerMembership } = await supabase
      .from("membership")
      .select("group_role")
      .eq("group_id", target.group_id)
      .eq("profile_id", user.id)
      .maybeSingle();
    if (!callerMembership || callerMembership.group_role !== "group_admin") {
      return NextResponse.json({ error: "forbidden", message: "Only a group admin can change roles." }, { status: 403 });
    }
  }

  const admin = createSupabaseAdminClient();
  const { data: updated, error } = await admin
    .from("membership")
    .update({
      ...(parsed.data.pickupPlaceId !== undefined && { pickup_place_id: parsed.data.pickupPlaceId }),
      ...(parsed.data.groupRole !== undefined && { group_role: parsed.data.groupRole }),
    })
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "update_failed", message: error?.message }, { status: 500 });
  }

  return NextResponse.json({ membership: updated });
}
