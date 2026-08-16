import { createClient } from "@supabase/supabase-js";
import { env } from "@/env";
import type { Database } from "@/types/database";

// Service-role client — bypasses RLS entirely. Only for server-side code that has already done its
// own authorization check (CLAUDE.md §3.5: authenticate -> authorize -> validate -> act -> audit).
// Never import this from a client component; src/env.ts already throws if that happens, since this
// module imports it.
export function createSupabaseAdminClient() {
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
