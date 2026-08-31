import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/api/adminAuth";
import { pushChannelStatus } from "@/lib/push/send";

// GET /api/admin/health — push delivery health, the scheduler's own pulse, and recent cron
// activity. Maps API errors aren't reported: Phase 6 (Google Maps) isn't built yet, so there's
// nothing to surface there.
//
// D-21 lesson: an empty auto-close list means either "nothing was abandoned" or "the scheduler has
// been dead for weeks", and for weeks it meant the second without anyone noticing. `scheduler` now
// reports the job itself, so the two cases are told apart.
const STALE_AFTER_MINUTES = 20; // four missed 5-minute ticks
export async function GET() {
  const auth = await authenticateAdmin();
  if (!auth.ok) return auth.response;
  const { admin } = auth;

  const [{ data: subs }, { data: cronRuns }, { data: cronJob }] = await Promise.all([
    admin.from("push_subscription").select("failure_count, last_success_at"),
    admin
      .from("audit_log")
      .select("id, action, entity_id, after, created_at")
      .eq("action", "cron_auto_close")
      .order("created_at", { ascending: false })
      .limit(20),
    admin.rpc("carpool_cron_status"),
  ]);

  const totalSubscriptions = (subs ?? []).length;
  const failingSubscriptions = (subs ?? []).filter((s) => s.failure_count > 0).length;
  const deadSubscriptions = (subs ?? []).filter((s) => s.failure_count >= 5).length;

  const job = (cronJob ?? [])[0] ?? null;
  const lastRunAt = job?.last_run_at ?? null;
  const minutesSinceRun = lastRunAt ? (Date.now() - new Date(lastRunAt).getTime()) / 60_000 : null;
  const scheduler = {
    // No row at all means the migration ran but nothing scheduled the job — the D-21 state.
    scheduled: job !== null,
    active: job?.active ?? false,
    schedule: job?.schedule ?? null,
    lastRunAt,
    lastStatus: job?.last_status ?? null,
    stale: job === null || minutesSinceRun === null || minutesSinceRun > STALE_AFTER_MINUTES,
  };

  return NextResponse.json({
    // `channel` reports the sending side; the counts report the receiving side. A healthy-looking
    // set of subscriptions with an unconfigured channel is the exact state in which every
    // notification is written to the bell and none of them ever reaches a phone.
    push: { totalSubscriptions, failingSubscriptions, deadSubscriptions, channel: pushChannelStatus() },
    scheduler,
    recentCronAutoCloses: cronRuns ?? [],
    maps: { status: "not_applicable", message: "Phase 6 (Google Maps) not built yet" },
  });
}
