import { test, expect, type Page } from "@playwright/test";
import { E2E_DRIVER_EMAIL, E2E_RIDER_EMAIL, E2E_PASSWORD } from "./global-setup";

// G5 — the core loop, driven through the real UI (not the API directly): sign in, publish a trip,
// a second account joins it, the driver starts and closes it, the rider gives kudos, and the
// leaderboard reflects it. Uses the two fixed seeded accounts from global-setup.ts rather than
// signing up fresh ones per run (Supabase's signup email rate limit makes that impractical).

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByPlaceholder("you@company.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(password);
  await page.locator("button.btnP", { hasText: "Sign in" }).click();
  // Post-signin lands on "/" either way — LockedGate (no group yet) or a redirect to /app (has a
  // group) — wait for whichever settled destination actually renders.
  await page.locator(".tabbar, h2:has-text('No group yet')").first().waitFor({ state: "visible", timeout: 10_000 });
}

async function createGroup(page: Page, groupName: string) {
  const lockedCreateLink = page.getByText("Or create a new group →");
  if (await lockedCreateLink.isVisible().catch(() => false)) {
    await lockedCreateLink.click();
  } else {
    await page.locator(".tab", { hasText: "Group" }).click();
    await page.getByText("+ Create a new group").click();
  }
  await page.getByPlaceholder("e.g. South Office Pool").fill(groupName);
  await page.getByPlaceholder("Riverside").fill("Riverside");
  await page.getByPlaceholder("HQ").fill("HQ");
  await page.locator(".sheetc button.btnP", { hasText: "Create group" }).click();
  await page.waitForURL(/\/app\?g=/, { timeout: 10_000 });
}

async function getGroupCode(page: Page): Promise<string> {
  await page.locator(".tab", { hasText: "Group" }).click();
  const codeText = await page.getByText(/^[A-Z0-9]{6}$/).first().innerText();
  return codeText.trim();
}

async function joinGroupByCode(page: Page, code: string) {
  const lockedEnterCode = page.getByText("Enter a code");
  if (await lockedEnterCode.isVisible().catch(() => false)) {
    await lockedEnterCode.click();
    await page.getByPlaceholder("6-digit invite code").fill(code);
    await page.locator("button.btnP", { hasText: "Join group & finish" }).click();
  } else {
    // Already has a group from a prior run — the header's own "▾" just switches tabs; only
    // GroupScreen's internal dropdown (visible once on the Group tab) opens the switch-group sheet.
    await page.locator(".tab", { hasText: "Group" }).click();
    await page.locator("main button", { hasText: "▾" }).first().click();
    await page.getByPlaceholder("Enter invite code").fill(code);
    await page.getByRole("button", { name: "Join", exact: true }).click();
  }
  await page.waitForURL(/\/app/, { timeout: 10_000 });
}

test("core loop: publish, join, start, close, kudos, leaderboard", async ({ browser }) => {
  const driverContext = await browser.newContext();
  const riderContext = await browser.newContext();
  const driver = await driverContext.newPage();
  const rider = await riderContext.newPage();

  const groupName = `E2E Group ${Date.now()}`;

  await test.step("driver signs in and creates a group", async () => {
    await signIn(driver, E2E_DRIVER_EMAIL, E2E_PASSWORD);
    await createGroup(driver, groupName);
    await expect(driver.getByText(groupName).first()).toBeVisible();
  });

  const groupCode = await test.step("driver reads the invite code", () => getGroupCode(driver));

  await test.step("driver publishes a trip departing soon", async () => {
    await driver.locator(".tab", { hasText: "Carpools" }).click();
    await driver.locator(".fab").click();
    await expect(driver.getByText("Offer a trip")).toBeVisible();
    await driver.locator("input[type=time]").first().fill("07:45");
    await driver.locator("button.btnP", { hasText: "Publish to" }).click();
    await expect(driver.getByText("YOU'RE DRIVING")).toBeVisible({ timeout: 10_000 });
  });

  await test.step("rider signs in and joins the group", async () => {
    await signIn(rider, E2E_RIDER_EMAIL, E2E_PASSWORD);
    await joinGroupByCode(rider, groupCode);
    await expect(rider.getByText(groupName).first()).toBeVisible();
  });

  await test.step("rider joins the trip", async () => {
    await rider.locator(".tab", { hasText: "Carpools" }).click();
    await rider.locator(".card").first().click();
    await expect(rider.getByText("Request to join")).toBeVisible({ timeout: 10_000 });
    await rider.getByText("Request to join").click();
    await expect(rider.getByText(/riding this trip/)).toBeVisible({ timeout: 10_000 });
  });

  await test.step("driver starts and closes the trip, confirming the rider", async () => {
    const detailLoaded = driver.waitForResponse((r) => /\/api\/trips\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "GET");
    await driver.locator(".card").first().click();
    await detailLoaded;
    const started = driver.waitForResponse((r) => r.url().includes("/start") && r.request().method() === "POST");
    await driver.getByText("Start trip · notify riders").click({ timeout: 15_000 });
    await started;
    await expect(driver.getByText("Trip in progress")).toBeVisible({ timeout: 10_000 });
    await driver.getByText("End & close trip").click();
    await expect(driver.getByRole("heading", { name: "Close trip" })).toBeVisible();
    await driver.locator("button.btnP", { hasText: "Close & notify riders" }).click();
    await expect(driver.getByText("Trip closed")).toBeVisible({ timeout: 10_000 });
    await driver.locator(".ov .iconbtn").first().click(); // back out of the trip detail overlay
  });

  await test.step("rider gives kudos", async () => {
    await rider.reload();
    await rider.locator(".card").first().click();
    await expect(rider.getByText("Rate your ride")).toBeVisible({ timeout: 10_000 });
    // D-18: the 💚 toggle starts off, so the submit reads "Skip & close" until the rider opts in.
    await rider.getByRole("button", { name: /Give kudos/ }).click();
    await rider.locator("button.btnP", { hasText: "Send kudos" }).click();
    await expect(rider.getByText("Kudos sent to")).toBeVisible({ timeout: 10_000 });
  });

  await test.step("leaderboard reflects the driver's score", async () => {
    await driver.locator(".tab", { hasText: "Ranks" }).click();
    await expect(driver.getByText("Leaderboard")).toBeVisible({ timeout: 10_000 });
    await expect(driver.getByText("15", { exact: true }).first()).toBeVisible();
  });

  await driverContext.close();
  await riderContext.close();
});
