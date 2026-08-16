import { z } from "zod";

// Safe to import from client components — only NEXT_PUBLIC_* variables, which Next.js inlines into
// the browser bundle at build time. See src/env.ts for the server-only, full-schema counterpart.
const schema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
  NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY: z.string().optional(),
});

export const clientEnv = schema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY: process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY,
});
