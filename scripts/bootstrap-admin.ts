import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

// Idempotent — promotes the profile matching ADMIN_BOOTSTRAP_EMAIL to platform_admin. Safe to
// re-run: no-ops if that profile is already platform_admin. The first platform_admin must come from
// here, not a hardcoded id, per 02_IMPLEMENTATION_PLAN.md's Phase 8 non-negotiables.
// Run with: pnpm admin:bootstrap

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../.env.local");
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  const env: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]!] = match[2]!;
  }
  return env;
}

async function main() {
  const env = loadEnvLocal();
  const email = env.ADMIN_BOOTSTRAP_EMAIL;
  if (!email || email.includes("REPLACE_ME")) {
    throw new Error("ADMIN_BOOTSTRAP_EMAIL is not set in .env.local");
  }

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listError) throw listError;
  const authUser = list.users.find((u) => u.email === email);
  if (!authUser) {
    throw new Error(`No auth user found for ADMIN_BOOTSTRAP_EMAIL (${email}) — sign up with that email first.`);
  }

  const { data: profile, error: profileError } = await admin
    .from("profile")
    .select("id, display_name, platform_role")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) {
    throw new Error(`Auth user for ${email} exists but has no profile row yet — sign in at least once first.`);
  }

  if (profile.platform_role === "platform_admin") {
    console.log(`${email} (${profile.display_name}) is already platform_admin. Nothing to do.`);
    return;
  }

  const { error: updateError } = await admin.from("profile").update({ platform_role: "platform_admin" }).eq("id", authUser.id);
  if (updateError) throw updateError;

  console.log(`Promoted ${email} (${profile.display_name}) to platform_admin.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  // process.exitCode (not process.exit()) — forcing an immediate exit here crashes with a libuv
  // assertion on Windows while Supabase's async client handles are still closing.
  process.exitCode = 1;
});
