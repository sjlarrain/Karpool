import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/api/adminAuth";

// GET /api/admin/feedback?category=&limit=&offset= — D-25: everything submitted through the
// Profile tab's feedback form, newest first, with the sender and their group resolved. Read-only:
// feedback is a record of what someone said, and an admin editing it would make it worthless.
export async function GET(request: Request) {
  const auth = await authenticateAdmin();
  if (!auth.ok) return auth.response;
  const { admin } = auth;

  const url = new URL(request.url);
  // Narrowed against the same union the column holds — an unrecognised ?category= is ignored rather
  // than passed through to the query.
  const CATEGORIES = ["bug", "idea", "praise", "other"] as const;
  const requested = url.searchParams.get("category");
  const category = (CATEGORIES as readonly string[]).includes(requested ?? "")
    ? (requested as (typeof CATEGORIES)[number])
    : null;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  let query = admin
    .from("feedback")
    .select("id, profile_id, group_id, category, message, user_agent, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (category) query = query.eq("category", category);

  const { data: rows, error, count } = await query;
  if (error) {
    return NextResponse.json({ error: "lookup_failed", message: error.message }, { status: 500 });
  }

  const profileIds = [...new Set((rows ?? []).map((r) => r.profile_id).filter((v): v is string => !!v))];
  const groupIds = [...new Set((rows ?? []).map((r) => r.group_id).filter((v): v is string => !!v))];

  const [{ data: profiles }, { data: groups }] = await Promise.all([
    profileIds.length > 0
      ? admin.from("profile").select("id, display_name").in("id", profileIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    groupIds.length > 0
      ? admin.from("group").select("id, name").in("id", groupIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const groupById = new Map((groups ?? []).map((g) => [g.id, g]));

  const entries = (rows ?? []).map((r) => ({
    id: r.id,
    category: r.category,
    message: r.message,
    userAgent: r.user_agent,
    createdAt: r.created_at,
    // A deleted account leaves its feedback behind (profile_id goes null on delete) — say so
    // rather than rendering a blank name.
    senderName: r.profile_id ? (profileById.get(r.profile_id)?.display_name ?? "Unknown member") : "Deleted account",
    groupName: r.group_id ? (groupById.get(r.group_id)?.name ?? null) : null,
  }));

  return NextResponse.json({ entries, total: count ?? entries.length, limit, offset });
}
