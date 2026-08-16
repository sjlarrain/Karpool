import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/env";
import type { Database } from "@/types/database";

// Session-scoped client for Server Components and Route Handlers — respects RLS as the calling
// user (D-04). For privileged writes that must bypass RLS, use createSupabaseAdminClient instead.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component render, which can't set cookies — the middleware
          // session refresh handles it on the next request instead.
        }
      },
    },
  });
}
