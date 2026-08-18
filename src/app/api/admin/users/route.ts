import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/api/adminAuth";

// GET /api/admin/users?search=&limit=&offset= — platform-wide user list (G9: 403 for non-admin).
export async function GET(request: Request) {
  const auth = await authenticateAdmin();
  if (!auth.ok) return auth.response;
  const { admin } = auth;

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  let query = admin
    .from("profile")
    .select("id, display_name, initials, avatar_color, platform_role, created_at, last_seen_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (search) {
    query = query.ilike("display_name", `%${search}%`);
  }

  const { data: profiles, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: "lookup_failed", message: error.message }, { status: 500 });
  }

  // Email lives on auth.users, not profile — bulk-fetched and matched by id, same pattern used by
  // scripts/bootstrap-admin.ts and tests/e2e/global-setup.ts.
  const { data: authList, error: authError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (authError) {
    return NextResponse.json({ error: "auth_lookup_failed", message: authError.message }, { status: 500 });
  }
  const emailById = new Map(authList.users.map((u) => [u.id, u.email ?? null]));

  const users = (profiles ?? []).map((p) => ({ ...p, email: emailById.get(p.id) ?? null }));

  return NextResponse.json({ users, total: count ?? users.length, limit, offset });
}
