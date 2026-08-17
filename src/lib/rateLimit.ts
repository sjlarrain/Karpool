import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Postgres-backed rather than in-memory: Vercel serverless functions don't share memory across
// instances or survive cold starts, so an in-memory counter wouldn't actually limit anything in
// production. Records a hit on every call that's still within budget; callers that reject the
// request (e.g. validation failure before this check) simply never record one.
export async function checkRateLimit(
  admin: SupabaseClient<Database>,
  profileId: string,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean }> {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count } = await admin
    .from("rate_limit_hit")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("action", action)
    .gte("created_at", since);

  if ((count ?? 0) >= limit) {
    return { allowed: false };
  }

  await admin.from("rate_limit_hit").insert({ profile_id: profileId, action });
  return { allowed: true };
}
