import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("pickup_place")
    .select("*")
    .eq("group_id", id)
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  return NextResponse.json({ pickupPlaces: data ?? [] });
}

const createSchema = z.object({
  label: z.string().trim().min(1).max(80),
  address: z.string().trim().min(1).max(160),
  typicalTime: z.string().trim().max(20).optional(),
  sortOrder: z.number().int().min(0).optional(),
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
  const { data: pickupPlace, error } = await admin
    .from("pickup_place")
    .insert({
      group_id: id,
      label: parsed.data.label,
      address: parsed.data.address,
      typical_time: parsed.data.typicalTime ?? null,
      sort_order: parsed.data.sortOrder ?? 0,
    })
    .select()
    .single();

  if (error || !pickupPlace) {
    return NextResponse.json({ error: "create_failed", message: error?.message }, { status: 500 });
  }

  return NextResponse.json({ pickupPlace }, { status: 201 });
}
