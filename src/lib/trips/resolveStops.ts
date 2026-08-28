import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { TripDirection } from "@/domain/types";

// D-29. A trip may carry one stop per leg, chosen from the group's own admin-managed list. The
// database enforces the leg rule (a leg the trip doesn't travel can't carry a stop) but it cannot
// cheaply enforce the other two facts, so the API — the only writer — does:
//
//   * the place belongs to *this* group, not another group the caller happens to see, and
//   * it is a `stop`, not a `pickup` point, so a member's home address can never be published as a
//     detour the whole car makes.
//
// Legs the trip doesn't travel come back null rather than as an error: zod has already rejected the
// malformed request, and this keeps the writer honest if a direction is ever edited underneath it.
export async function resolveTripStops(
  supabase: SupabaseClient<Database>,
  groupId: string,
  direction: TripDirection,
  outStopId: string | null | undefined,
  backStopId: string | null | undefined,
): Promise<
  { ok: true; outStopId: string | null; backStopId: string | null } | { ok: false; error: "unknown_stop" | "lookup_failed" }
> {
  const wantedOut = direction === "back" ? null : outStopId ?? null;
  const wantedBack = direction === "out" ? null : backStopId ?? null;

  const ids = [...new Set([wantedOut, wantedBack].filter((v): v is string => !!v))];
  if (ids.length === 0) {
    return { ok: true, outStopId: null, backStopId: null };
  }

  const { data, error } = await supabase
    .from("pickup_place")
    .select("id")
    .eq("group_id", groupId)
    .eq("kind", "stop")
    .in("id", ids);
  if (error) {
    return { ok: false, error: "lookup_failed" };
  }

  const known = new Set((data ?? []).map((row) => row.id));
  if (ids.some((id) => !known.has(id))) {
    return { ok: false, error: "unknown_stop" };
  }

  return { ok: true, outStopId: wantedOut, backStopId: wantedBack };
}
