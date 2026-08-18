import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/api/adminAuth";

// GET /api/admin/ledger?profileId=&groupId=&limit=&offset= — every points_ledger entry, filterable.
export async function GET(request: Request) {
  const auth = await authenticateAdmin();
  if (!auth.ok) return auth.response;
  const { admin } = auth;

  const url = new URL(request.url);
  const profileId = url.searchParams.get("profileId");
  const groupId = url.searchParams.get("groupId");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  let query = admin
    .from("points_ledger")
    .select("id, profile_id, group_id, trip_id, kind, points, reason, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (profileId) query = query.eq("profile_id", profileId);
  if (groupId) query = query.eq("group_id", groupId);

  const { data: entries, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: "lookup_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ entries: entries ?? [], total: count ?? (entries ?? []).length, limit, offset });
}
