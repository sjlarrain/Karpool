import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// G9: "a platform_admin can list users, open one, and read that user's trips, ledger, and audit
// trail; a non-admin gets 403 on every admin route."
// G10: "every admin mutation and every privileged PII read writes an audit_log row."
//
// These hit the real /api/admin/* route handlers over HTTP against an already-running `pnpm dev`
// server — they can't be called as plain functions, since createSupabaseServerClient() depends on
// next/headers' cookies(), which only works inside a real request. Requires a live Supabase project
// (SUPABASE_SERVICE_ROLE_KEY set) and the dev server running at APP_URL (defaults to
// http://localhost:3000). Skips itself if the service role key isn't set, same as tests/rls.
// Run via `pnpm test:admin`.

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "admin-test-password-123!";

const canRun = Boolean(SERVICE_ROLE_KEY);

async function signIn(email: string, password: string): Promise<string> {
  const res = await fetch(`${APP_URL}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign in failed for ${email}: ${res.status} ${await res.text()}`);
  const setCookies = res.headers.getSetCookie?.() ?? [];
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

describe.skipIf(!canRun)("G9/G10 — admin route auth + audit trail", () => {
  let admin: SupabaseClient;
  let memberCookie: string;
  let adminCookie: string;
  let memberId: string;
  let adminId: string;
  let groupId: string;
  let tripId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY as string);

    const stamp = Date.now();
    const { data: member, error: memberErr } = await admin.auth.admin.createUser({
      email: `admin-test-member-${stamp}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (memberErr || !member.user) throw memberErr ?? new Error("failed to create member user");
    memberId = member.user.id;

    const { data: adminUser, error: adminErr } = await admin.auth.admin.createUser({
      email: `admin-test-admin-${stamp}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (adminErr || !adminUser.user) throw adminErr ?? new Error("failed to create admin user");
    adminId = adminUser.user.id;

    const { error: promoteErr } = await admin.from("profile").update({ platform_role: "platform_admin" }).eq("id", adminId);
    if (promoteErr) throw promoteErr;

    const { data: group, error: groupErr } = await admin
      .from("group")
      .insert({ name: "Admin Test Group", origin_label: "A", dest_label: "HQ", code: `ADMT${String(stamp).slice(-2)}`, created_by: memberId })
      .select()
      .single();
    if (groupErr || !group) throw groupErr ?? new Error("failed to create test group");
    groupId = group.id;
    await admin.from("membership").insert({ group_id: groupId, profile_id: memberId });

    const { data: trip, error: tripErr } = await admin
      .from("trip")
      .insert({ group_id: groupId, driver_id: memberId, direction: "out", depart_at: new Date().toISOString(), capacity: 3 })
      .select()
      .single();
    if (tripErr || !trip) throw tripErr ?? new Error("failed to create test trip");
    tripId = trip.id;

    try {
      memberCookie = await signIn(member.user.email as string, PASSWORD);
      adminCookie = await signIn(adminUser.user.email as string, PASSWORD);
    } catch (err) {
      throw new Error(
        `Could not sign in against ${APP_URL} — is \`pnpm dev\` running? Original error: ${err instanceof Error ? err.message : err}`,
      );
    }
  });

  const FAKE_ID = "00000000-0000-0000-0000-000000000000";
  const adminRoutes: { method: string; path: () => string; body?: unknown }[] = [
    { method: "GET", path: () => "/api/admin/metrics" },
    { method: "GET", path: () => "/api/admin/users" },
    { method: "GET", path: () => `/api/admin/users/${FAKE_ID}` },
    { method: "PATCH", path: () => `/api/admin/users/${FAKE_ID}/role`, body: { role: "member" } },
    { method: "GET", path: () => "/api/admin/groups" },
    { method: "GET", path: () => "/api/admin/trips" },
    { method: "POST", path: () => `/api/admin/trips/${FAKE_ID}/force-close`, body: { reason: "test" } },
    { method: "GET", path: () => "/api/admin/ledger" },
    { method: "POST", path: () => "/api/admin/ledger/adjust", body: { profileId: FAKE_ID, groupId: FAKE_ID, points: 1, reason: "test" } },
    { method: "GET", path: () => "/api/admin/audit-log" },
    { method: "GET", path: () => "/api/admin/health" },
  ];

  it.each(adminRoutes)("$method $path() 403s for a non-admin", async ({ method, path, body }) => {
    const res = await fetch(`${APP_URL}${path()}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: memberCookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    expect(res.status).toBe(403);
  });

  it("logs an audit_log row when an admin opens a user's detail", async () => {
    const res = await fetch(`${APP_URL}/api/admin/users/${memberId}`, { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);

    const { data: rows } = await admin
      .from("audit_log")
      .select("id")
      .eq("action", "view_user_detail")
      .eq("actor_profile_id", adminId)
      .eq("entity_id", memberId);
    expect(rows?.length ?? 0).toBeGreaterThan(0);
  });

  it("logs an audit_log row when an admin adjusts the ledger", async () => {
    const res = await fetch(`${APP_URL}/api/admin/ledger/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ profileId: memberId, groupId, points: 7, reason: "G10 test adjustment" }),
    });
    expect(res.status).toBe(201);
    const entry = await res.json();

    const { data: rows } = await admin.from("audit_log").select("id").eq("action", "admin_adjust_ledger").eq("entity_id", entry.entry.id);
    expect(rows?.length ?? 0).toBeGreaterThan(0);
  });

  it("logs an audit_log row when an admin force-closes a trip", async () => {
    const res = await fetch(`${APP_URL}/api/admin/trips/${tripId}/force-close`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ reason: "G10 test force-close" }),
    });
    expect(res.status).toBe(200);

    const { data: rows } = await admin.from("audit_log").select("id").eq("action", "force_close_trip").eq("entity_id", tripId);
    expect(rows?.length ?? 0).toBeGreaterThan(0);
  });

  afterAll(async () => {
    if (tripId) await admin.from("trip").delete().eq("id", tripId);
    if (groupId) {
      await admin.from("points_ledger").delete().eq("group_id", groupId);
      await admin.from("group").delete().eq("id", groupId);
    }
    // audit_log rows reference profile via actor_profile_id (every mutation in this suite was
    // performed BY adminId) as well as entity_id (some target memberId/groupId/tripId) — both must
    // be cleared before deleting the users, or the profile->auth.users cascade fails with a foreign
    // key violation and deleteUser() silently no-ops (its error isn't thrown, only returned).
    const ownedIds = [adminId, memberId].filter(Boolean);
    if (ownedIds.length > 0) {
      await admin.from("audit_log").delete().in("actor_profile_id", ownedIds);
    }
    const entityIds = [memberId, groupId, tripId].filter(Boolean);
    if (entityIds.length > 0) {
      await admin.from("audit_log").delete().in("entity_id", entityIds);
    }

    if (memberId) {
      const { error } = await admin.auth.admin.deleteUser(memberId);
      if (error) console.error(`cleanup: failed to delete member test user ${memberId}: ${error.message}`);
    }
    if (adminId) {
      const { error } = await admin.auth.admin.deleteUser(adminId);
      if (error) console.error(`cleanup: failed to delete admin test user ${adminId}: ${error.message}`);
    }
  });
});
