import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminShell } from "./AdminShell";

// /admin — platform_admin only. Non-admins get a 403-equivalent message, not a silent redirect,
// per 02_IMPLEMENTATION_PLAN.md's "a non-admin gets 403 on every admin route" (G9) — the UI mirrors
// what every /api/admin/* route already enforces server-side.
export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    redirect("/");
  }

  const { data: profile } = await supabase
    .from("profile")
    .select("id, display_name, platform_role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile || profile.platform_role !== "platform_admin") {
    return (
      <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--page)" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🔒</div>
          <h1 style={{ font: "800 20px var(--font-display)", color: "var(--ink)", margin: "0 0 6px" }}>403 — Admins only</h1>
          <p style={{ font: "600 13px var(--font-body)", color: "rgba(0,0,0,.5)", margin: 0 }}>
            Your account doesn&apos;t have platform admin access.
          </p>
        </div>
      </main>
    );
  }

  return <AdminShell adminName={profile.display_name} />;
}
