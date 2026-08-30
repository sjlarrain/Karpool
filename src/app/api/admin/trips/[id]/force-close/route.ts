import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdmin } from "@/lib/api/adminAuth";
import { writeAuditLog } from "@/lib/audit";
import { closeTrip } from "@/lib/api/closeTrip";

const bodySchema = z.object({ reason: z.string().trim().min(1).max(500) });

// POST /api/admin/trips/:id/force-close — safety-net close for a stuck trip.
//
// D-35 answer (A) changed what this does, deliberately. It used to never touch points_ledger, on
// the grounds that nobody had confirmed who actually rode. That rule made sense while a forgotten
// close was a rare operational mess; it does not survive D-35, where the close is also what
// materialises the return leg and so becomes the thing an admin is expected to do for a driver who
// forgot. Leaving it points-free would mean a driver who drove two legs is paid for neither.
//
// So a STARTED trip now takes the full restricted close: every active rider is confirmed, nobody
// is marked a no-show, the driver is paid the normal award, and the return leg is generated. A
// trip that never started keeps the old status-only behaviour — no ride happened, so there is
// nothing to pay for and no return leg to build.
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

  if (trip.status === "started") {
    const result = await closeTrip({ tripId: id, actor: { profileId: adminProfile.id, isGroupAdmin: true } });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });
    }

    await writeAuditLog(admin, {
      actorProfileId: adminProfile.id,
      action: "force_close_trip",
      entityType: "trip",
      entityId: id,
      before: { status: trip.status },
      after: {
        status: "closed",
        reason: parsed.data.reason,
        mode: result.mode,
        confirmedCount: result.confirmedCount,
        pointsAwarded: result.pointsAwarded,
        backTripId: result.backTripId,
      },
      request,
    });

    return NextResponse.json({
      trip: result.trip,
      mode: result.mode,
      confirmedCount: result.confirmedCount,
      pointsAwarded: result.pointsAwarded,
      backTripId: result.backTripId,
    });
  }

  // Never started: close the row and nothing else. No ledger entry, no return leg.
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
    after: { status: "closed", reason: parsed.data.reason, mode: "status_only" },
    request,
  });

  return NextResponse.json({ trip: updated, mode: "status_only" });
}
