import { z } from "zod";

// Server-only. Validates every variable in .env.example at boot and fails fast with the specific
// variable name, per 00_DEV_ENVIRONMENT_SETUP.md §5.2. Import src/env.client.ts from anything that
// might end up in a client bundle instead.
if (typeof window !== "undefined") {
  throw new Error(
    "src/env.ts is server-only and must never be imported from a client component — use src/env.client.ts instead.",
  );
}

const requiredString = (label: string) =>
  z
    .string()
    .min(1, `${label} is required`)
    .refine((v) => !v.includes("REPLACE_ME"), `${label} is still set to REPLACE_ME — fill it in from 01_PLATFORM_SETUP.md`);

const requiredUrl = (label: string) =>
  z
    .string()
    .url(`${label} must be a valid URL`)
    .refine((v) => !v.includes("REPLACE_ME"), `${label} is still set to REPLACE_ME — fill it in from 01_PLATFORM_SETUP.md`);

const schema = z.object({
  // Needed today (local dev, Phase 1/2).
  NEXT_PUBLIC_APP_URL: requiredUrl("NEXT_PUBLIC_APP_URL"),
  APP_ENV: z.enum(["development", "preview", "production"]),
  NEXT_PUBLIC_SUPABASE_URL: requiredUrl("NEXT_PUBLIC_SUPABASE_URL"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: requiredString("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  SUPABASE_SERVICE_ROLE_KEY: requiredString("SUPABASE_SERVICE_ROLE_KEY"),

  // Phase 5 (push): now actually read by src/lib/push/send.ts and /api/cron/tick.
  VAPID_SUBJECT: requiredString("VAPID_SUBJECT"),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: requiredString("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
  VAPID_PRIVATE_KEY: requiredString("VAPID_PRIVATE_KEY"),
  CRON_SECRET: requiredString("CRON_SECRET"),

  // Not read by any app code yet. The Supabase CLI reads DATABASE_URL/DIRECT_URL directly from
  // process.env for migrations, not through this schema; Phases 6/8 vars aren't wired up yet either
  // (no Vercel deployment). Validated loosely so the app can boot without them; tighten only if/when
  // app code starts actually consuming one of these.
  DATABASE_URL: z.string().optional(),
  DIRECT_URL: z.string().optional(),
  GOOGLE_MAPS_SERVER_KEY: z.string().optional(),
  NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY: z.string().optional(),
  ADMIN_BOOTSTRAP_EMAIL: z.string().optional(),
});

function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${problems}`);
  }
  return parsed.data;
}

export const env = loadEnv();
