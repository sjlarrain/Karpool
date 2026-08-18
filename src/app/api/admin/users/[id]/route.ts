import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/api/adminAuth";
import { writeAuditLog } from "@/lib/audit";

// GET /api/admin/users/:id — a member's full profile: memberships, trips (as driver or rider),
// ledger history, kudos received. G10: every user-detail open writes an audit_log row, since this
// surfaces PII an admin wouldn't otherwise see.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authenticateAdmin();
  if (!auth.ok) return auth.response;
  const { admin, adminProfile } = auth;

  const { data: profile, error: profileError } = await admin
    .from("profile")
    .select("id, display_name, initials, avatar_color, platform_role, created_at, last_seen_at")
    .eq("id", id)
    .maybeSingle();
  if (profileError) {
    return NextResponse.json({ error: "lookup_failed", message: profileError.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(id);
  if (authError) {
    return NextResponse.json({ error: "auth_lookup_failed", message: authError.message }, { status: 500 });
  }

  const [{ data: memberships }, { data: driven }, { data: ridden }, { data: ledger }, { data: kudosReceived }] = await Promise.all([
    admin.from("membership").select("group_id, group_role, joined_at").eq("profile_id", id),
    admin.from("trip").select("id, group_id, status, depart_at").eq("driver_id", id).order("depart_at", { ascending: false }).limit(20),
    admin.from("trip_rider").select("trip_id, state, joined_at").eq("profile_id", id).order("joined_at", { ascending: false }).limit(20),
    admin.from("points_ledger").select("id, group_id, trip_id, kind, points, reason, created_at").eq("profile_id", id).order("created_at", { ascending: false }).limit(50),
    admin.from("kudos").select("id, trip_id, from_profile_id, comment, created_at").eq("to_profile_id", id).order("created_at", { ascending: false }).limit(20),
  ]);

  await writeAuditLog(admin, {
    actorProfileId: adminProfile.id,
    action: "view_user_detail",
    entityType: "profile",
    entityId: id,
    request,
  });

  return NextResponse.json({
    profile: { ...profile, email: authUser.user?.email ?? null },
    memberships: memberships ?? [],
    tripsDriven: driven ?? [],
    tripsRidden: ridden ?? [],
    ledger: ledger ?? [],
    kudosReceived: kudosReceived ?? [],
  });
}
