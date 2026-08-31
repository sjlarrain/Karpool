import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redeemPendingInvite } from "@/lib/api/redeemPendingInvite";
import { AuthGate } from "./AuthGate";
import { LockedGate } from "./LockedGate";

// /auth/callback sends a confirmation link it couldn't use back here, with the reason.
const AUTH_NOTICES: Record<string, string> = {
  link_expired: "That confirmation link has expired or was already used. Sign in below — or sign up again if you never finished.",
  link_invalid: "That confirmation link didn't work. Try signing in, and ask for a fresh link if you still can't get in.",
};

export default async function RootPage({ searchParams }: { searchParams: Promise<{ auth?: string }> }) {
  const { auth } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return (
      <main style={{ minHeight: "100vh" }}>
        <div style={{ maxWidth: 430, margin: "0 auto" }}>
          <AuthGate initialNotice={auth ? AUTH_NOTICES[auth] : undefined} />
        </div>
      </main>
    );
  }

  const { data: memberships } = await supabase
    .from("membership")
    .select("group_id")
    .eq("profile_id", userData.user.id)
    .limit(1);

  if (!memberships || memberships.length === 0) {
    // Before showing the locked screen, honour an invite that never made it through the
    // confirmation email — see src/lib/api/redeemPendingInvite.ts. Asking someone to type a code
    // they already clicked is the failure this catches.
    if (await redeemPendingInvite(userData.user)) redirect("/app");

    return (
      <main style={{ minHeight: "100vh" }}>
        <div style={{ maxWidth: 430, margin: "0 auto" }}>
          <LockedGate />
        </div>
      </main>
    );
  }

  redirect("/app");
}
