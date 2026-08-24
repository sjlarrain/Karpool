import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { E2E_DRIVER_EMAIL, E2E_PASSWORD } from "./global-setup";
import { createGroup, getGroupCode, signIn } from "./helpers";

// The onboarding fix: a visitor who clicks an invite, signs up, and confirms their email must come
// back **signed in and inside the group**. Before /auth/callback existed they landed signed out on
// "/" with the invite code gone, which is where every real signup died.
//
// The confirmation email can't be received here, so the token is minted with the admin API's
// generateLink — the same `token_hash` Supabase's own `{{ .TokenHash }}` template puts in the mail.
// Everything after that point is the real route, the real session cookie and the real join.

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

const envLocal = loadEnvLocal();
const admin = createClient(envLocal.NEXT_PUBLIC_SUPABASE_URL!, envLocal.SUPABASE_SERVICE_ROLE_KEY!);
const createdUserIds: string[] = [];

// Mints an unconfirmed account plus the token its confirmation email would have carried.
async function pendingSignup(code: string, carryCodeInMetadata: boolean) {
  const email = `e2e-confirm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@carpool.test`;
  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email,
    password: E2E_PASSWORD,
    options: {
      data: {
        display_name: "Confirm Tester",
        ...(carryCodeInMetadata ? { pending_group_code: code } : {}),
      },
    },
  });
  if (error) throw error;
  if (data.user) createdUserIds.push(data.user.id);
  return { email, tokenHash: data.properties!.hashed_token };
}

test.afterAll(async () => {
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
});

test("signup survives email confirmation and keeps the invite", async ({ browser }) => {
  const driverContext = await browser.newContext();
  const driver = await driverContext.newPage();
  const groupName = `Confirm Group ${Date.now()}`;
  let code = "";

  await test.step("an existing member has a group to be invited to", async () => {
    await signIn(driver, E2E_DRIVER_EMAIL, E2E_PASSWORD);
    await createGroup(driver, groupName);
    code = await getGroupCode(driver);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
  });

  await test.step("confirming the email lands the newcomer inside the group, signed in", async () => {
    const { tokenHash } = await pendingSignup(code, false);
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`/auth/callback?token_hash=${tokenHash}&type=signup&next=${encodeURIComponent(`/j/${code}`)}`);

    // /j/CODE joins the group and redirects into the app — no code retyped, no second sign-in.
    await page.waitForURL(/\/app\?g=/, { timeout: 15_000 });
    await expect(page.locator(".tabbar")).toBeVisible();
    await expect(page.locator(".tab", { hasText: "Group" })).toBeVisible();
    await context.close();
  });

  await test.step("the stashed group code rescues a link that lost its ?next", async () => {
    const { tokenHash } = await pendingSignup(code, true);
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`/auth/callback?token_hash=${tokenHash}&type=signup`);

    await page.waitForURL(/\/app\?g=/, { timeout: 15_000 });
    await expect(page.locator(".tabbar")).toBeVisible();
    await context.close();
  });

  await test.step("a dead link explains itself instead of dumping the visitor on a blank page", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("/auth/callback?token_hash=not-a-real-token&type=signup");

    await page.waitForURL(/\/\?auth=link_expired/, { timeout: 15_000 });
    await expect(page.getByText(/confirmation link has expired/i)).toBeVisible();
    await context.close();
  });

  await driverContext.close();
});
