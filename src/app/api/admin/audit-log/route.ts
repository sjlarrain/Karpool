import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/api/adminAuth";

// GET /api/admin/audit-log?action=&entityType=&actorProfileId=&limit=&offset= — the audit trail
// itself. Read-only; audit_log has no UPDATE/DELETE path anywhere, including for admins (D-14).
export async function GET(request: Request) {
  const auth = await authenticateAdmin();
  if (!auth.ok) return auth.response;
  const { admin } = auth;

  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const entityType = url.searchParams.get("entityType");
  const actorProfileId = url.searchParams.get("actorProfileId");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  let query = admin
    .from("audit_log")
    .select("id, actor_profile_id, action, entity_type, entity_id, before, after, ip, user_agent, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (action) query = query.eq("action", action);
  if (entityType) query = query.eq("entity_type", entityType);
  if (actorProfileId) query = query.eq("actor_profile_id", actorProfileId);

  const { data: entries, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: "lookup_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ entries: entries ?? [], total: count ?? (entries ?? []).length, limit, offset });
}
