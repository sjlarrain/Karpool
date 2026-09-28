import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/audit";
import { transition } from "@/domain/tripMachine";
import { checkPostpone, POSTPONE_ERROR_MESSAGES, type PostponeError } from "@/domain/tripPostpone";
import { formatTripTime } from "@/domain/tripDay";
import { viewerTimeZone } from "@/lib/time/viewerTimeZone";
import { notifyProfiles } from "@/lib/notify/tripNotify";

const bodySchema = z.object({
  departAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be a valid date/time"),
});

// The database re-checks what needs no zone and raises these by name.
const DB_ERRORS: readonly string[] = ["wrong_status", "not_later", "after_return"];

// POST /api/trips/:id/postpone — D-63. Driver only. A ride settles by itself at its departure time
// (D-61); when the driver could not actually leave then, this moves it to a later time THE SAME
// DAY and rolls the settle back: the points it paid (the driver's pay, kudos, both sides of a
// no-show report) are cancelled by new ledger rows, kudos records are cleared, and everyone who was
// in the car holds a seat again and may leave for free. When the new time arrives the ride settles
// and pays once, like any other. A round trip's return leg is left exactly as it is.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const { data: trip } = await supabase
    .from("trip")
    .select("driver_id, status, depart_at, return_at")
    .eq("id", id)
    .maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = transition(
    { status: trip.status, driverId: trip.driver_id, departAt: trip.depart_at },
    "postpone",
    { profileId: user.id },
  );
  if (!result.ok) {
    return result.error === "not_driver"
      ? NextResponse.json({ error: "forbidden" }, { status: 403 })
      : NextResponse.json({ error: "not_settled", message: POSTPONE_ERROR_MESSAGES.not_settled }, { status: 409 });
  }

  const timeZone = await viewerTimeZone();
  const check = checkPostpone(
    { status: trip.status, departAt: trip.depart_at, returnAt: trip.return_at },
    parsed.data.departAt,
    new Date(),
    timeZone,
  );
  if (!check.ok) {
    return NextResponse.json({ error: check.error, message: POSTPONE_ERROR_MESSAGES[check.error] }, { status: 409 });
  }

  const admin = createSupabaseAdminClient();
  const { data: postponed, error } = await admin.rpc("postpone_trip", {
    p_trip_id: id,
    p_new_depart_at: new Date(parsed.data.departAt).toISOString(),
  });
  if (error) {
    const code = DB_ERRORS.find((name) => error.message.includes(name));
    if (code) {
      const key: PostponeError = code === "wrong_status" ? "not_settled" : (code as PostponeError);
      return NextResponse.json({ error: key, message: POSTPONE_ERROR_MESSAGES[key] }, { status: 409 });
    }
    return NextResponse.json({ error: "postpone_failed", message: error.message }, { status: 500 });
  }
  const updated = Array.isArray(postponed) ? postponed[0] : postponed;

  await writeAuditLog(admin, {
    actorProfileId: user.id,
    action: "trip_postponed",
    entityType: "trip",
    entityId: id,
    before: { status: trip.status, departAt: trip.depart_at },
    after: { status: updated?.status ?? "scheduled", departAt: updated?.depart_at ?? parsed.data.departAt },
    request,
  });

  // After the rollback, so a rider acting on the push finds their seat and the free drop-out
  // already in place.
  const { data: riders } = await admin
    .from("trip_rider")
    .select("profile_id")
    .eq("trip_id", id)
    .in("state", ["joined", "confirmed"]);
  const riderProfileIds = (riders ?? []).map((r) => r.profile_id).filter((pid): pid is string => !!pid);
  const from = formatTripTime(new Date(trip.depart_at), timeZone);
  const to = formatTripTime(new Date(parsed.data.departAt), timeZone);
  const notify = await notifyProfiles(riderProfileIds, {
    type: "change",
    title: "Ride postponed",
    body: `Your driver moved today's ${from} ride to ${to}. Your seat is kept. If it no longer works for you, you can leave with no points lost.`,
    tripId: id,
  });

  return NextResponse.json({
    trip: updated,
    notifiedRiders: notify.error ? 0 : riderProfileIds.length,
    ...(notify.error && { notifyError: notify.error }),
  });
}
