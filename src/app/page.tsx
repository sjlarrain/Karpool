import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AuthGate } from "./AuthGate";
import { LockedGate } from "./LockedGate";

export default async function RootPage() {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return (
      <main style={{ minHeight: "100vh" }}>
        <div style={{ maxWidth: 430, margin: "0 auto" }}>
          <AuthGate />
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
