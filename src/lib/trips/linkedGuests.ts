import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Developer, 2026-09-21: "Use users name rather than the (G) name." A seat booked for someone on the
// guest list keeps that guest's typed name in `trip_rider.guest_name`. Once a group admin links the
// guest to the member they turned out to be (D-55), the seat should be SHOWN as that member — their
// real name, initials and colour — everywhere a seat is drawn. This resolves, for a set of guest
// seats, which member each one is linked to. Shared by the feed and the trip screen so the two can
// never show one person under two names.
//
// Display only: the seat is still a guest seat for everything else (who may remove it, what a
// no-show report may charge), and nothing here writes.

export interface LinkedMember {
  profileId: string;
  displayName: string;
  initials: string | null;
  avatarColor: string | null;
}

type Client = SupabaseClient<Database>;

/** group_guest id → the member it is linked to. Unlinked guests are simply absent from the map. */
export async function loadLinkedMembers(
  supabase: Client,
  groupGuestIds: (string | null)[],
): Promise<{ ok: true; byGuestId: Map<string, LinkedMember> } | { ok: false }> {
  const ids = [...new Set(groupGuestIds.filter((v): v is string => !!v))];
  if (ids.length === 0) return { ok: true, byGuestId: new Map() };

  const { data: guests, error } = await supabase
    .from("group_guest")
    .select("id, claimed_by_profile_id")
    .in("id", ids)
    .not("claimed_by_profile_id", "is", null);
  if (error) return { ok: false };

  const profileIds = [...new Set((guests ?? []).map((g) => g.claimed_by_profile_id).filter((v): v is string => !!v))];
  if (profileIds.length === 0) return { ok: true, byGuestId: new Map() };

  const { data: profiles, error: profileError } = await supabase
    .from("profile")
    .select("id, display_name, initials, avatar_color")
    .in("id", profileIds);
  if (profileError) return { ok: false };

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const byGuestId = new Map<string, LinkedMember>();
  for (const g of guests ?? []) {
    const p = g.claimed_by_profile_id ? profileById.get(g.claimed_by_profile_id) : undefined;
    // A profile RLS will not show us is left out, and the seat falls back to its typed name.
    if (p) {
      byGuestId.set(g.id, {
        profileId: p.id,
        displayName: p.display_name,
        initials: p.initials,
        avatarColor: p.avatar_color,
      });
    }
  }
  return { ok: true, byGuestId };
}
