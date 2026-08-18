import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/api/adminAuth";

// GET /api/admin/metrics — headline counts for the admin console's landing view.
export async function GET() {
  const auth = await authenticateAdmin();
  if (!auth.ok) return auth.response;
  const { admin } = auth;

  const [{ count: userCount }, { count: groupCount }, { count: ledgerCount }, { data: tripStatusRows }] = await Promise.all([
    admin.from("profile").select("id", { count: "exact", head: true }),
    admin.from("group").select("id", { count: "exact", head: true }),
    admin.from("points_ledger").select("id", { count: "exact", head: true }),
    admin.from("trip").select("status"),
  ]);

  const tripsByStatus = { scheduled: 0, started: 0, closed: 0, cancelled: 0 };
  for (const row of tripStatusRows ?? []) {
    tripsByStatus[row.status] += 1;
  }

  return NextResponse.json({
    userCount: userCount ?? 0,
    groupCount: groupCount ?? 0,
    ledgerEntryCount: ledgerCount ?? 0,
    tripsByStatus,
    totalTrips: (tripStatusRows ?? []).length,
  });
}
