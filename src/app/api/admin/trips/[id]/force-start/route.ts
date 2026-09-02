import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/api/adminAuth";
import { writeAuditLog } from "@/lib/audit";
import { startTrip } from "@/lib/api/startTrip";

// POST /api/admin/trips/:id/force-start — D-50 (2026-09-01): the platform admin console's
// easier-access counterpart to force-close. A platform admin is treated as having the group
// admin's authority here, the same shortcut force-close already takes (it does not check the
// admin's own membership row either) — the console is for fixing a stuck trip regardless of which
// group it belongs to. scheduled -> started, subject to the same T-2h window (D-16) as the
// driver's own Start button; nothing here bypasses that.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authenticateAdmin();
  if (!auth.ok) return auth.response;
  const { admin, adminProfile } = auth;

  const { data: trip, error: tripError } = await admin.from("trip").select("id, status").eq("id", id).maybeSingle();
  if (tripError) {
    return NextResponse.json({ error: "lookup_failed", message: tripError.message }, { status: 500 });
  }
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await startTrip(id, { profileId: adminProfile.id, isGroupAdmin: true });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, message: result.message }, { status: result.status });
  }

  await writeAuditLog(admin, {
    actorProfileId: adminProfile.id,
    action: "force_start_trip",
    entityType: "trip",
    entityId: id,
    before: { status: trip.status },
    after: { status: "started", notifiedRiders: result.notifiedRiders },
    request,
  });

  return NextResponse.json({
    trip: result.trip,
    notifiedRiders: result.notifiedRiders,
    pushDelivery: result.pushDelivery,
  });
}
