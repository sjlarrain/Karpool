import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/api/adminAuth";

// GET /api/admin/groups — every group with member count, trip count, and its code.
export async function GET() {
  const auth = await authenticateAdmin();
  if (!auth.ok) return auth.response;
  const { admin } = auth;

  const { data: groups, error } = await admin
    .from("group")
    .select("id, name, code, origin_label, dest_label, created_at, created_by")
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: "lookup_failed", message: error.message }, { status: 500 });
  }
  if (!groups || groups.length === 0) {
    return NextResponse.json({ groups: [] });
  }

  const groupIds = groups.map((g) => g.id);
  const [{ data: memberships }, { data: trips }] = await Promise.all([
    admin.from("membership").select("group_id").in("group_id", groupIds),
    admin.from("trip").select("group_id").in("group_id", groupIds),
  ]);

  const memberCountByGroup = new Map<string, number>();
  for (const m of memberships ?? []) {
    memberCountByGroup.set(m.group_id, (memberCountByGroup.get(m.group_id) ?? 0) + 1);
  }
  const tripCountByGroup = new Map<string, number>();
  for (const t of trips ?? []) {
    tripCountByGroup.set(t.group_id, (tripCountByGroup.get(t.group_id) ?? 0) + 1);
  }

  return NextResponse.json({
    groups: groups.map((g) => ({
      ...g,
      memberCount: memberCountByGroup.get(g.id) ?? 0,
      tripCount: tripCountByGroup.get(g.id) ?? 0,
    })),
  });
}
