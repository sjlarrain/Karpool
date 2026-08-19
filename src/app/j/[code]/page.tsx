import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isValidGroupCodeFormat, normalizeGroupCode } from "@/domain/groupCode";
import { AuthGate } from "@/app/AuthGate";

// /j/:code — the destination of the group invite link that GET /api/groups/:id and the Group tab
// have been handing out since Phase 2. The link was live in the UI but this route never existed, so
// every invite anyone shared 404'd.
//
// Signed in  -> join the group (idempotent) and land on it.
// Signed out -> show which group the invite is for, then the normal auth flow with the code already
//               filled in. Signing in calls router.refresh(), which re-runs this component and
//               completes the join, so the visitor never has to type the code they just clicked.

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: "100vh" }}>
      <div style={{ maxWidth: 430, margin: "0 auto" }}>{children}</div>
    </main>
  );
}

export default async function JoinByCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = normalizeGroupCode(decodeURIComponent(rawCode));

  if (!isValidGroupCodeFormat(code)) {
    return (
      <Shell>
        <div style={{ padding: "72px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 40 }}>🔗</div>
          <h1 style={{ font: "800 22px var(--font-display)", color: "var(--ink)", margin: "14px 0 6px" }}>
            That invite link isn&apos;t valid
          </h1>
          <p style={{ font: "500 13px var(--font-body)", color: "var(--muted)", margin: "0 0 20px" }}>
            Ask whoever shared it to send a fresh one.
          </p>
          <Link href="/" className="btnG" style={{ display: "block", textDecoration: "none" }}>
            Go to Carpool
          </Link>
        </div>
      </Shell>
    );
  }

  // A non-member can't read the group row under RLS (is_member gates it), so the lookup goes through
  // the service-role client — same shape as POST /api/groups/join.
  const admin = createSupabaseAdminClient();
  const { data: group } = await admin
    .from("group")
    .select("id, name, origin_label, dest_label")
    .eq("code", code)
    .maybeSingle();

  if (!group) {
    return (
      <Shell>
        <div style={{ padding: "72px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 40 }}>🤷</div>
          <h1 style={{ font: "800 22px var(--font-display)", color: "var(--ink)", margin: "14px 0 6px" }}>
            No group has that code
          </h1>
          <p style={{ font: "500 13px var(--font-body)", color: "var(--muted)", margin: "0 0 20px" }}>
            The group may have been renamed or removed.
          </p>
          <Link href="/" className="btnG" style={{ display: "block", textDecoration: "none" }}>
            Go to Carpool
          </Link>
        </div>
      </Shell>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (userData.user) {
    const { data: existing } = await admin
      .from("membership")
      .select("id")
      .eq("group_id", group.id)
      .eq("profile_id", userData.user.id)
      .maybeSingle();

    if (!existing) {
      await admin.from("membership").insert({ group_id: group.id, profile_id: userData.user.id, group_role: "member" });
    }

    redirect(`/app?g=${group.id}`);
  }

  return (
    <Shell>
      <div style={{ padding: "40px 24px 0", textAlign: "center" }}>
        <div style={{ fontSize: 34 }}>🚗</div>
        <p style={{ font: "600 12px var(--font-body)", color: "var(--muted)", margin: "12px 0 2px" }}>
          You&apos;ve been invited to
        </p>
        <h1 style={{ font: "800 24px var(--font-display)", color: "var(--ink)", margin: "0 0 4px" }}>{group.name}</h1>
        <p style={{ font: "600 12px var(--font-body)", color: "var(--muted)", margin: 0 }}>
          {group.origin_label} → {group.dest_label}
        </p>
      </div>
      <AuthGate presetCode={code} hideHero />
    </Shell>
  );
}
