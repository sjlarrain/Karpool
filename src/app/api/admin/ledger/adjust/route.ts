import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdmin } from "@/lib/api/adminAuth";
import { writeAuditLog } from "@/lib/audit";

const bodySchema = z.object({
  profileId: z.string().uuid(),
  groupId: z.string().uuid(),
  points: z.number().int().refine((v) => v !== 0, "points must be nonzero"),
  reason: z.string().trim().min(1).max(500),
});

// POST /api/admin/ledger/adjust — manual, signed ledger correction. points_ledger is append-only
// (CLAUDE.md §3.5): this INSERTs a new admin_adjust row, it never edits or removes history.
export async function POST(request: Request) {
  const auth = await authenticateAdmin();
  if (!auth.ok) return auth.response;
  const { admin, adminProfile } = auth;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const [{ data: profile }, { data: group }] = await Promise.all([
    admin.from("profile").select("id").eq("id", parsed.data.profileId).maybeSingle(),
    admin.from("group").select("id").eq("id", parsed.data.groupId).maybeSingle(),
  ]);
  if (!profile || !group) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: entry, error } = await admin
    .from("points_ledger")
    .insert({
      profile_id: parsed.data.profileId,
      group_id: parsed.data.groupId,
      kind: "admin_adjust",
      points: parsed.data.points,
      reason: parsed.data.reason,
    })
    .select()
    .single();
  if (error || !entry) {
    return NextResponse.json({ error: "ledger_write_failed", message: error?.message }, { status: 500 });
  }

  await writeAuditLog(admin, {
    actorProfileId: adminProfile.id,
    action: "admin_adjust_ledger",
    entityType: "points_ledger",
    entityId: entry.id,
    after: { profile_id: parsed.data.profileId, group_id: parsed.data.groupId, points: parsed.data.points, reason: parsed.data.reason },
    request,
  });

  return NextResponse.json({ entry }, { status: 201 });
}
