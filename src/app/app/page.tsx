import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/env";
import { loadGroupTrips } from "@/lib/trips/loadGroupTrips";
import { AppShell } from "./AppShell";

export default async function AppHome({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  const { g } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/");

  const { data: memberships } = await supabase
    .from("membership")
    .select("group_id, group_role")
    .eq("profile_id", userData.user.id)
    .order("joined_at", { ascending: true });

  if (!memberships || memberships.length === 0) redirect("/");

  const activeGroupId = g && memberships.some((m) => m.group_id === g) ? g : memberships[0]!.group_id;
  const activeRole = memberships.find((m) => m.group_id === activeGroupId)?.group_role ?? "member";

  const [{ data: group }, { data: pickupPlaces }, { count: memberCount }, { data: allGroupRows }, { data: viewerProfile }] =
    await Promise.all([
      supabase.from("group").select("*").eq("id", activeGroupId).single(),
      supabase.from("pickup_place").select("*").eq("group_id", activeGroupId).order("sort_order", { ascending: true }),
      supabase.from("membership").select("*", { count: "exact", head: true }).eq("group_id", activeGroupId),
      supabase
        .from("group")
        .select("id, name")
        .in(
          "id",
          memberships.map((m) => m.group_id),
        ),
      supabase.from("profile").select("display_name, platform_role").eq("id", userData.user.id).maybeSingle(),
    ]);

  if (!group) redirect("/");

  const { data: creator } = await supabase.from("profile").select("display_name").eq("id", group.created_by).maybeSingle();

  const otherGroups = (allGroupRows ?? []).filter((row) => row.id !== activeGroupId);

  const tripsResult = await loadGroupTrips(supabase, activeGroupId, userData.user.id, new Date());

  return (
    <AppShell
      group={group}
      role={activeRole}
      memberCount={memberCount ?? 0}
      adminName={creator?.display_name ?? null}
      pickupPlaces={pickupPlaces ?? []}
      inviteLink={`${env.NEXT_PUBLIC_APP_URL}/j/${group.code}`}
      otherGroups={otherGroups}
      trips={tripsResult.ok ? tripsResult.trips : []}
      viewerName={viewerProfile?.display_name ?? "You"}
      isPlatformAdmin={viewerProfile?.platform_role === "platform_admin"}
    />
  );
}
