import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { env } from "@/env";
import { redeemPendingInvite } from "@/lib/api/redeemPendingInvite";
import { loadGroupTrips } from "@/lib/trips/loadGroupTrips";
import { viewerTimeZone } from "@/lib/time/viewerTimeZone";
import { AppShell } from "./AppShell";

export default async function AppHome({ searchParams }: { searchParams: Promise<{ g?: string; trip?: string }> }) {
  // ?trip= is how /t/:id (the ride share link) and, later, a notification tap open a specific ride:
  // the shell renders normally and the trip detail overlay opens on top of it.
  const { g, trip: initialTripId } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/");

  const { data: memberships } = await supabase
    .from("membership")
    .select("id, group_id, group_role, pickup_place_id")
    .eq("profile_id", userData.user.id)
    .order("joined_at", { ascending: true });

  if (!memberships || memberships.length === 0) {
    // Same rescue as the root page: an invite stranded by the confirmation email is redeemed here
    // rather than shown as a locked screen. Redirecting re-runs this component, which then finds
    // the membership that was just created.
    const redeemed = await redeemPendingInvite(userData.user);
    redirect(redeemed ? `/app?g=${redeemed}` : "/");
  }

  const activeGroupId = g && memberships.some((m) => m.group_id === g) ? g : memberships[0]!.group_id;
  const activeMembership = memberships.find((m) => m.group_id === activeGroupId);
  const activeRole = activeMembership?.group_role ?? "member";

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

  // Trip times are rendered here, on the server, so the server has to be told which zone the
  // reader is in — its own is UTC in production.
  const timeZone = await viewerTimeZone();
  const tripsResult = await loadGroupTrips(supabase, activeGroupId, userData.user.id, new Date(), timeZone);

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
      initialTripId={initialTripId ?? null}
      membershipId={activeMembership?.id ?? ""}
      pickupPlaceId={activeMembership?.pickup_place_id ?? null}
      isPlatformAdmin={viewerProfile?.platform_role === "platform_admin"}
    />
  );
}
