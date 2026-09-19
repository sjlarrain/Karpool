import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { writeAuditLog } from "@/lib/audit";
import { computeNoShowReport } from "@/domain/points";
import { rosterWindow } from "@/lib/api/rosterWindow";
import { notifyProfiles } from "@/lib/notify/tripNotify";

const bodySchema = z.object({ tripRiderId: z.string().uuid() });

// POST /api/trips/:id/no-show — D-61 (developer, 2026-09-19). The driver reports that a rider who
// booked a seat didn't ride.
//
// With Start and Close gone, the scheduler counts every booked seat as ridden at departure; this is
// how the driver corrects that, until the end of the departure day. The rider is charged the
// group's no_show_penalty (-5 by default) and the driver is paid no_show_report_bonus (+2) for
// reporting it — on top of the seat pay they keep, because they held the seat and drove.
//
// Only a seat the rider BOOKED THEMSELVES can be reported. A seat the driver added (D-24) — member
// or guest — is freed with DELETE /riders/:riderId or /guests/:tripRiderId instead: that person
// never asked for the seat, so they are not charged, and the driver is not paid for it.
//
// Refused once the rider has given kudos for this leg: giving kudos is the rider saying they rode.
// There is no undo — the ledger is append-only — so the app confirms before calling this.
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

  // RLS (is_member) makes this null for a non-member, giving the same 404 as a missing trip.
  const { data: trip } = await supabase
    .from("trip")
    .select("id, driver_id, group_id, status, depart_at")
    .eq("id", id)
    .maybeSingle();
  if (!trip) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (trip.driver_id !== user.id) {
    return NextResponse.json({ error: "not_driver", message: "Only the driver can report a no-show." }, { status: 403 });
  }
  const gate = await rosterWindow(trip);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error, message: gate.message }, { status: 409 });
  }
  if (!gate.settled) {
    return NextResponse.json(
      { error: "not_settled", message: "The ride hasn't been counted yet — try again in a few minutes." },
      { status: 409 },
    );
  }

  const admin = createSupabaseAdminClient();

  const { data: seat, error: seatError } = await admin
    .from("trip_rider")
    .select("id, profile_id, added_by_profile_id, state")
    .eq("id", parsed.data.tripRiderId)
    .eq("trip_id", id)
    .maybeSingle();
  if (seatError) {
    return NextResponse.json({ error: "seat_lookup_failed", message: seatError.message }, { status: 500 });
  }
  if (!seat || seat.state !== "confirmed") {
    return NextResponse.json({ error: "not_found", message: "That rider isn't on this ride." }, { status: 404 });
  }
  if (!seat.profile_id || seat.added_by_profile_id) {
    return NextResponse.json(
      {
        error: "not_self_booked",
        message: "You added this seat yourself — remove it instead. Nobody is charged for a seat they didn't book.",
      },
      { status: 409 },
    );
  }

  const { data: kudos, error: kudosError } = await admin
    .from("kudos")
    .select("id")
    .eq("trip_id", id)
    .eq("from_profile_id", seat.profile_id)
    .limit(1);
  if (kudosError) {
    return NextResponse.json({ error: "kudos_lookup_failed", message: kudosError.message }, { status: 500 });
  }
  if ((kudos ?? []).length > 0) {
    return NextResponse.json(
      { error: "already_rated", message: "They already gave kudos for this ride, so they rode." },
      { status: 409 },
    );
  }

  const { data: group, error: groupError } = await admin
    .from("group")
    .select("no_show_penalty, no_show_report_bonus")
    .eq("id", trip.group_id)
    .maybeSingle();
  if (groupError || !group) {
    return NextResponse.json({ error: "group_lookup_failed", message: groupError?.message }, { status: 500 });
  }

  // The claim: a compare-and-swap on `confirmed`, so a double tap reports once and charges once.
  const { data: flipped, error: flipError } = await admin
    .from("trip_rider")
    .update({ state: "no_show" })
    .eq("id", seat.id)
    .eq("state", "confirmed")
    .select("id")
    .maybeSingle();
  if (flipError) {
    return NextResponse.json({ error: "report_failed", message: flipError.message }, { status: 500 });
  }
  if (!flipped) {
    return NextResponse.json({ error: "already_reported", message: "Already reported." }, { status: 409 });
  }

  const report = computeNoShowReport(group.no_show_penalty, group.no_show_report_bonus);
  const { error: ledgerError } = await admin.from("points_ledger").insert([
    { profile_id: seat.profile_id, group_id: trip.group_id, trip_id: id, ...report.rider },
    { profile_id: trip.driver_id, group_id: trip.group_id, trip_id: id, ...report.driver },
  ]);
  if (ledgerError) {
    // One insert, so either both rows landed or neither did. Hand the seat back so the report can
    // simply be made again.
    await admin.from("trip_rider").update({ state: "confirmed" }).eq("id", seat.id).eq("state", "no_show");
    return NextResponse.json({ error: "ledger_write_failed", message: ledgerError.message }, { status: 500 });
  }

  await writeAuditLog(admin, {
    actorProfileId: user.id,
    action: "trip_no_show_reported",
    entityType: "trip_rider",
    entityId: seat.id,
    before: { state: "confirmed" },
    after: { state: "no_show", riderPoints: report.rider.points, driverPoints: report.driver.points },
    request,
  });

  // Last, after everything that matters is written: someone charged points deserves to know why.
  await notifyProfiles([seat.profile_id], {
    type: "change",
    title: "Marked as a no-show",
    body: `Your driver reported you didn't ride. ${report.rider.points} pts.`,
    tripId: id,
  });

  return NextResponse.json({ riderPoints: report.rider.points, driverPoints: report.driver.points });
}
