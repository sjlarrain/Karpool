import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Shared "authenticate" step (CLAUDE.md §3.5: authenticate -> authorize -> validate -> act) for API
// routes using the caller's session-scoped client.
export async function requireUser(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
