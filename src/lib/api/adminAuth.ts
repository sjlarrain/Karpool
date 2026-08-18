import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";

// Shared "authorize" step for every /api/admin/* route (CLAUDE.md §3.5: authenticate -> authorize
// -> validate -> act -> audit). Always re-checks against the admin client, never trusts a role
// claim from the client — per 02_IMPLEMENTATION_PLAN.md's Phase 8 non-negotiables.
export async function requireAdmin(admin: SupabaseClient<Database>, userId: string) {
  const { data: profile, error } = await admin.from("profile").select("id, display_name, platform_role").eq("id", userId).maybeSingle();
  if (error || !profile || profile.platform_role !== "platform_admin") return null;
  return profile;
}

// Combines authenticate (session) + authorize (platform_admin) for every admin route. Returns a
// ready 401/403 response on failure so routes can `if (!auth.ok) return auth.response;` and move on.
export async function authenticateAdmin(): Promise<
  | { ok: true; admin: SupabaseClient<Database>; adminProfile: { id: string; display_name: string; platform_role: "member" | "platform_admin" } }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  }

  const admin = createSupabaseAdminClient();
  const adminProfile = await requireAdmin(admin, user.id);
  if (!adminProfile) {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  return { ok: true, admin, adminProfile };
}
