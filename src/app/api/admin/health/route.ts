import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/api/adminAuth";

// GET /api/admin/health — push delivery health + recent cron activity. Maps API errors aren't
// reported: Phase 6 (Google Maps) isn't built yet, so there's nothing to surface there.
export async function GET() {
  const auth = await authenticateAdmin();
  if (!auth.ok) return auth.response;
  const { admin } = auth;

  const [{ data: subs }, { data: cronRuns }] = await Promise.all([
    admin.from("push_subscription").select("failure_count, last_success_at"),
    admin
      .from("audit_log")
      .select("id, action, entity_id, after, created_at")
      .eq("action", "cron_auto_close")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const totalSubscriptions = (subs ?? []).length;
  const failingSubscriptions = (subs ?? []).filter((s) => s.failure_count > 0).length;
  const deadSubscriptions = (subs ?? []).filter((s) => s.failure_count >= 5).length;

  return NextResponse.json({
    push: { totalSubscriptions, failingSubscriptions, deadSubscriptions },
    recentCronAutoCloses: cronRuns ?? [],
    maps: { status: "not_applicable", message: "Phase 6 (Google Maps) not built yet" },
  });
}
