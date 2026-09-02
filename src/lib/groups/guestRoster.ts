import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { initialsFor } from "@/domain/initials";
import { avatarColorFor } from "@/domain/avatarColor";
import { tallyUnclaimedGuestRides, claimantByGuestId } from "@/domain/guestRoster";

// D-55: the group's guest roster with each guest's ride count and, where an admin has linked them,
// the member their rides now belong to. Shared by the roster route and the leaderboard, so the
// count a group admin sees on the Group tab is the same number that moves onto a member's line when
// they link the two — computed once, in one place.
//
// initials and colour are derived rather than stored: initialsFor/avatarColorFor already do this
// for every entity without a profile row, which is what guest riders have always been.

export interface RosterGuest {
  id: string;
  displayName: string;
  initials: string;
  color: string;
  // Confirmed seats on closed trips, the same definition of "pooled" the leaderboard uses.
  rides: number;
  claimedBy: { profileId: string; name: string } | null;
  claimedAt: string | null;
}

type Client = SupabaseClient<Database>;

export async function loadGuestRoster(
  supabase: Client,
  groupId: string,
): Promise<{ ok: true; guests: RosterGuest[] } | { ok: false; error: "guest_lookup_failed" }> {
  const { data: guests, error } = await supabase
    .from("group_guest")
    .select("id, display_name, claimed_by_profile_id, claimed_at")
    .eq("group_id", groupId)
    .order("display_name", { ascending: true });
  if (error) {
    return { ok: false, error: "guest_lookup_failed" };
  }
  const rows = guests ?? [];
  if (rows.length === 0) {
    return { ok: true, guests: [] };
  }

  // A guest's rides are counted the same way a member's are — confirmed seats on closed trips —
  // so the number does not change meaning when it moves onto a member's line.
  const { data: closedTrips } = await supabase.from("trip").select("id").eq("group_id", groupId).eq("status", "closed");
  const closedTripIds = (closedTrips ?? []).map((t) => t.id);

  const { data: seats } =
    closedTripIds.length > 0
      ? await supabase
          .from("trip_rider")
          .select("group_guest_id")
          .in("trip_id", closedTripIds)
          .eq("state", "confirmed")
          .not("group_guest_id", "is", null)
      : { data: [] };

  // Counted per guest regardless of claim state — the roster screen shows an admin what a guest is
  // carrying *before* they decide to link it, which is the whole basis for that decision.
  const rides = new Map<string, number>();
  for (const seat of seats ?? []) {
    if (!seat.group_guest_id) continue;
    rides.set(seat.group_guest_id, (rides.get(seat.group_guest_id) ?? 0) + 1);
  }

  const claimantIds = [...new Set(rows.map((g) => g.claimed_by_profile_id).filter((v): v is string => !!v))];
  const { data: claimants } =
    claimantIds.length > 0
      ? await supabase.from("profile").select("id, display_name").in("id", claimantIds)
      : { data: [] };
  const claimantById = new Map((claimants ?? []).map((c) => [c.id, c.display_name]));

  return {
    ok: true,
    guests: rows.map((g) => ({
      id: g.id,
      displayName: g.display_name,
      initials: initialsFor(g.display_name),
      color: avatarColorFor(g.id),
      rides: rides.get(g.id) ?? 0,
      claimedBy: g.claimed_by_profile_id
        ? { profileId: g.claimed_by_profile_id, name: claimantById.get(g.claimed_by_profile_id) ?? "Member" }
        : null,
      claimedAt: g.claimed_at,
    })),
  };
}

// The greyed "not registered yet" rows on Ranks: guests nobody has linked, with the rides they have
// actually taken. Claimed guests are absent by construction — their rides are on a member's line
// now, and showing both would count one ride twice on one screen.
export function unclaimedGuestEntries(
  guests: readonly RosterGuest[],
  seats: readonly { group_guest_id: string | null }[],
): { guestId: string; name: string; initials: string; color: string; rides: number }[] {
  const claims = claimantByGuestId(guests.map((g) => ({ id: g.id, claimedByProfileId: g.claimedBy?.profileId ?? null })));
  const rides = tallyUnclaimedGuestRides(
    seats.map((s) => ({ profileId: null, groupGuestId: s.group_guest_id })),
    claims,
  );
  return guests
    .filter((g) => !g.claimedBy && (rides.get(g.id) ?? 0) > 0)
    .map((g) => ({ guestId: g.id, name: g.displayName, initials: g.initials, color: g.color, rides: rides.get(g.id) ?? 0 }));
}
