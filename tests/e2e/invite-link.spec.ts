import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { E2E_DRIVER_EMAIL, E2E_RIDER_EMAIL, E2E_PASSWORD } from "./global-setup";
import { createGroup, getGroupCode, signIn } from "./helpers";

// The GROUP invite link, /j/:code — the one a member copies out of the Group tab and pastes into
// WhatsApp. Reported broken by the developer on 2026-08-31 ("the sharing link is not working so
// users can subscribe to the group"), and it turned out to be the one onboarding path with no
// coverage at all:
//
//   - share-link.spec.ts  covers the RIDE link (/t/:id), and its rider joins the group by *typing*
//                         the code into the app — never by clicking an invite.
//   - signup-confirm.spec covers /auth/callback, which only runs when Supabase's "Confirm email"
//                         is ON. The developer has it OFF (D-22), so no real visitor ever goes
//                         through that route: signUp returns a session immediately.
//
// Which leaves the actual live path — open /j/CODE while signed out, sign up right there, and be
// carried into the group by the refresh — tested by nothing. That is what this spec drives, along
// with the two neighbouring cases (an existing account signing in on the invite, and a signed-in
// non-member opening it).

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../../.env.local");
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]!] = match[2]!;
  }
  return env;
}

const envLocal = loadEnvLocal();
const admin = createClient(envLocal.NEXT_PUBLIC_SUPABASE_URL!, envLocal.SUPABASE_SERVICE_ROLE_KEY!);
const createdEmails: string[] = [];

test.afterAll(async () => {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const user of data?.users ?? []) {
    if (user.email && createdEmails.includes(user.email)) {
      await admin.auth.admin.deleteUser(user.id);
    }
  }
});

test("group invite link: a newcomer clicking it lands inside the group", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const groupName = `Invite Group ${Date.now()}`;
  let code = "";

  await test.step("a member stands up a group and reads its code", async () => {
    await signIn(owner, E2E_DRIVER_EMAIL, E2E_PASSWORD);
    await createGroup(owner, groupName);
    code = await getGroupCode(owner);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
  });

  await test.step("the invite page names the group to a signed-out visitor", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/j/${code}`);
    await expect(page.getByText("You've been invited to")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: groupName })).toBeVisible();
    await context.close();
  });

  await test.step("a newcomer signs up ON the invite page and is carried into the group", async () => {
    // The real path with Confirm email OFF: no email, no /auth/callback, no code retyped. The
    // signup returns a session, AuthGate refreshes, and /j/CODE completes the join server-side.
    const context = await browser.newContext();
    const page = await context.newPage();
    const email = `e2e-invite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@carpool.test`;
    createdEmails.push(email);

    await page.goto(`/j/${code}`);
    await page.locator(".segb", { hasText: "Sign up" }).click();
    await page.getByPlaceholder("you@company.com").fill(email);
    await page.getByPlaceholder("e.g. Alex Morgan").fill("Invite Newcomer");
    await page.getByPlaceholder("••••••••").fill(E2E_PASSWORD);
    await page.locator("button.btnP", { hasText: "Continue" }).click();

    // If Confirm email were ON this notice appears instead, and the visitor is stuck until they
    // fetch a mail. Asserted explicitly so that configuration change fails loudly here rather than
    // silently changing what this spec is proving.
    const confirmNotice = page.getByText(/Check your email to confirm/i);
    if (await confirmNotice.isVisible({ timeout: 3_000 }).catch(() => false)) {
      throw new Error(
        "Supabase 'Confirm email' is ON — the invite now depends on the email round trip, which this spec does not cover.",
      );
    }

    await page.waitForURL(/\/app\?g=/, { timeout: 15_000 });
    await expect(page.locator(".tabbar")).toBeVisible();
    await page.locator(".tab", { hasText: "Group" }).click();
    await expect(page.getByRole("heading", { name: groupName })).toBeVisible({ timeout: 10_000 });
    await context.close();
  });

  await test.step("an existing account signing in on the invite lands in the group too", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`/j/${code}`);
    await page.getByPlaceholder("you@company.com").fill(E2E_RIDER_EMAIL);
    await page.getByPlaceholder("••••••••").fill(E2E_PASSWORD);
    await page.locator("button.btnP", { hasText: "Sign in" }).click();

    await page.waitForURL(/\/app\?g=/, { timeout: 15_000 });
    await expect(page.locator(".tabbar")).toBeVisible();
    await context.close();
  });

  await test.step("an unusable code says so rather than dumping the visitor on a blank page", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/j/ZZZZ99");
    await expect(page.getByRole("heading", { name: /No group has that code/i })).toBeVisible();
    await context.close();
  });

  await ownerContext.close();
});
