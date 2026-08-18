import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdmin } from "@/lib/api/adminAuth";
import { writeAuditLog } from "@/lib/audit";

const bodySchema = z.object({ role: z.enum(["member", "platform_admin"]) });

// PATCH /api/admin/users/:id/role — promote/demote a user's platform_role.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authenticateAdmin();
  if (!auth.ok) return auth.response;
  const { admin, adminProfile } = auth;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const { data: before, error: beforeError } = await admin.from("profile").select("id, platform_role").eq("id", id).maybeSingle();
  if (beforeError) {
    return NextResponse.json({ error: "lookup_failed", message: beforeError.message }, { status: 500 });
  }
  if (!before) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (id === adminProfile.id && parsed.data.role === "member") {
    return NextResponse.json(
      { error: "invalid_request", message: "You can't demote your own account — have another admin do it." },
      { status: 400 },
    );
  }

  const { data: updated, error } = await admin.from("profile").update({ platform_role: parsed.data.role }).eq("id", id).select().single();
  if (error || !updated) {
    return NextResponse.json({ error: "update_failed", message: error?.message }, { status: 500 });
  }

  await writeAuditLog(admin, {
    actorProfileId: adminProfile.id,
    action: "update_user_role",
    entityType: "profile",
    entityId: id,
    before: { platform_role: before.platform_role },
    after: { platform_role: updated.platform_role },
    request,
  });

  return NextResponse.json({ profile: updated });
}
