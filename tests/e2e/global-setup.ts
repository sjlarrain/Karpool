import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { cleanupE2eData } from "./cleanup";

export const E2E_DRIVER_EMAIL = "e2e-driver@carpool.test";
export const E2E_RIDER_EMAIL = "e2e-rider@carpool.test";
export const E2E_PASSWORD = "E2ETestPass123!";

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../../.env.local");
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const env: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]!] = match[2]!;
  }
  return env;
}

export default async function globalSetup() {
  const env = loadEnvLocal();
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

  // Idempotent: creates the two fixed e2e accounts if they don't exist yet (ignoring "already
  // registered" so repeat runs don't fail or burn through Supabase's signup rate limit), and
  // returns the user id either way. Closes over `admin` rather than taking it as a parameter —
  // passing it across a function boundary tripped a real type mismatch between two resolutions of
  // @supabase/supabase-js's generic defaults (a pnpm hoisting quirk, not an app-code issue).
  async function ensureUser(email: string, displayName: string): Promise<string> {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: E2E_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (!error) return data.user.id;
    if (!error.message.toLowerCase().includes("already")) throw error;

    const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (listError) throw listError;
    const existing = list.users.find((u) => u.email === email);
    if (!existing) throw new Error(`${email} already registered but not found via listUsers()`);
    return existing.id;
  }

  const driverId = await ensureUser(E2E_DRIVER_EMAIL, "E2E Driver");
  await ensureUser(E2E_RIDER_EMAIL, "E2E Rider");
  // Every prior run's group/trip data is stale by the time a new run starts — clear it so
  // ".card first()"-style selectors in the spec aren't picking up leftovers from earlier runs.
  await cleanupE2eData(driverId);
}
