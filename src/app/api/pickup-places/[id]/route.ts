import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";

async function requireGroupAdminForPickupPlace(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
  pickupPlaceId: string,
) {
  const { data: pickupPlace } = await supabase
    .from("pickup_place")
    .select("id, group_id")
    .eq("id", pickupPlaceId)
    .maybeSingle();
  if (!pickupPlace) return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) } as const;

  const { data: membership } = await supabase
    .from("membership")
    .select("group_role")
    .eq("group_id", pickupPlace.group_id)
    .eq("profile_id", userId)
    .maybeSingle();
  if (!membership) return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) } as const;
  if (membership.group_role !== "group_admin") {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) } as const;
  }

  return { pickupPlace } as const;
}

const patchSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    address: z.string().trim().min(1).max(160),
    typicalTime: z.string().trim().max(20).nullable(),
    sortOrder: z.number().int().min(0),
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

  const authz = await requireGroupAdminForPickupPlace(supabase, user.id, id);
  if ("error" in authz) return authz.error;

  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: updated, error } = await admin
    .from("pickup_place")
    .update({
      ...(parsed.data.label !== undefined && { label: parsed.data.label }),
      ...(parsed.data.address !== undefined && { address: parsed.data.address }),
      ...(parsed.data.typicalTime !== undefined && { typical_time: parsed.data.typicalTime }),
      ...(parsed.data.sortOrder !== undefined && { sort_order: parsed.data.sortOrder }),
    })
    .eq("id", id)
    .select()
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "update_failed", message: error?.message }, { status: 500 });
  }

  return NextResponse.json({ pickupPlace: updated });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const authz = await requireGroupAdminForPickupPlace(supabase, user.id, id);
  if ("error" in authz) return authz.error;

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("pickup_place").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: "delete_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
