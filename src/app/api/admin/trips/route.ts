import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/api/adminAuth";

const VALID_STATUSES = ["scheduled", "started", "closed", "cancelled"] as const;

// GET /api/admin/trips?status=&limit=&offset= — cross-group trip explorer.
export async function GET(request: Request) {
  const auth = await authenticateAdmin();
  if (!auth.ok) return auth.response;
  const { admin } = auth;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = VALID_STATUSES.find((s) => s === statusParam) ?? null;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  let query = admin
    .from("trip")
    .select("id, group_id, driver_id, direction, depart_at, return_at, capacity, status, started_at, closed_at, cancelled_reason, created_at", {
      count: "exact",
    })
    .order("depart_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (status) {
    query = query.eq("status", status);
  }

  const { data: trips, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: "lookup_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ trips: trips ?? [], total: count ?? (trips ?? []).length, limit, offset });
}
