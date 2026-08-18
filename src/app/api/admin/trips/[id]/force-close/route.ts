import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdmin } from "@/lib/api/adminAuth";
import { writeAuditLog } from "@/lib/audit";

const bodySchema = z.object({ reason: z.string().trim().min(1).max(500) });

// POST /api/admin/trips/:id/force-close — safety-net close for a stuck trip. Never touches
// points_ledger (no driver confirmation of who actually rode, same rule as the cron auto-close) —
// this is an operational fix, not a substitute for the real close flow.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authenticateAdmin();
  if (!auth.ok) return auth.response;
  const { admin, adminProfile } = auth;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const { data: trip, error: tripError } = await admin.from("trip").select("id, status").eq("id", id).maybeSingle();
  if (tripError) {
    return NextResponse.json({ error: "lookup_failed", message: tripError.message }, { status: 500 });
  }
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (trip.status === "closed" || trip.status === "cancelled") {
    return NextResponse.json({ error: "wrong_status", message: `Trip is already ${trip.status}.` }, { status: 409 });
  }

  const closedAt = new Date().toISOString();
  const { data: updated, error } = await admin.from("trip").update({ status: "closed", closed_at: closedAt }).eq("id", id).select().single();
  if (error || !updated) {
    return NextResponse.json({ error: "update_failed", message: error?.message }, { status: 500 });
  }

  await writeAuditLog(admin, {
    actorProfileId: adminProfile.id,
    action: "force_close_trip",
    entityType: "trip",
    entityId: id,
    before: { status: trip.status },
    after: { status: "closed", reason: parsed.data.reason },
    request,
  });

  return NextResponse.json({ trip: updated });
}
