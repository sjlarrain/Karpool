import { test, expect, type Page } from "@playwright/test";
import { E2E_DRIVER_EMAIL, E2E_RIDER_EMAIL, E2E_PASSWORD } from "./global-setup";
import { createGroup, getGroupCode, joinGroupByCode, signIn, publishTrip } from "./helpers";

// D-20 — the ride share link. The point of the feature is that the link survives a paste into
// WhatsApp, and the point of the decision is that it carries nothing with it: only a signed-in
// member of the ride's group can see the ride. Both halves are driven through the real UI here.

interface CapturedShare {
  title: string;
  text?: string;
  url: string;
}

declare global {
  interface Window {
    __shares?: CapturedShare[];
  }
}

// Headless Chromium has no navigator.share, so the button would silently take the clipboard path
// and there would be nothing to assert on. Standing one up captures exactly what a phone's share
// sheet would have been handed.
async function captureShareSheet(page: Page) {
  await page.addInitScript(() => {
    window.__shares = [];
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: CapturedShare) => {
        window.__shares!.push(data);
      },
    });
  });
}

test("ride share link: shares a real URL, and reveals nothing to anyone outside the group", async ({ browser }) => {
  const driverContext = await browser.newContext();
  const driver = await driverContext.newPage();
  await captureShareSheet(driver);

  const groupName = `Share Group ${Date.now()}`;

  await test.step("driver signs in, creates a group and publishes a trip", async () => {
    await signIn(driver, E2E_DRIVER_EMAIL, E2E_PASSWORD);
    await createGroup(driver, groupName);
    await publishTrip(driver);
    await expect(driver.getByText("YOU'RE DRIVING")).toBeVisible({ timeout: 10_000 });
  });

  const groupCode = await test.step("driver reads the invite code", () => getGroupCode(driver));

  const shareUrl = await test.step("driver shares the ride from the trip detail overlay", async () => {
    await driver.locator(".tab", { hasText: "Carpools" }).click();
    await driver.locator(".card").first().click();
    await driver.getByRole("button", { name: "Share this ride" }).click({ timeout: 10_000 });

    const shares = await driver.evaluate(() => window.__shares ?? []);
    expect(shares).toHaveLength(1);
    const shared = shares[0]!;
    // The message is composed on the sharer's own device from what they can already see.
    expect(shared.text).toContain("→");
    expect(shared.text).toMatch(/seats? left\.$|The car is full\.$/);
    expect(shared.url).toMatch(/\/t\/[0-9a-f-]{36}$/);
    return shared.url;
  });

  await test.step("a signed-out visitor learns nothing but that they must sign in", async () => {
    const strangerContext = await browser.newContext();
    const stranger = await strangerContext.newPage();
    await stranger.goto(shareUrl);
    await expect(stranger.getByRole("heading", { name: "Sign in to see this ride" })).toBeVisible();
    await expect(stranger.getByText(groupName)).toHaveCount(0);
    await strangerContext.close();
  });

  const riderContext = await browser.newContext();
  const rider = await riderContext.newPage();

  await test.step("a signed-in non-member still can't see the ride", async () => {
    await signIn(rider, E2E_RIDER_EMAIL, E2E_PASSWORD);
    await rider.goto(shareUrl);
    await expect(rider.getByRole("heading", { name: "This ride isn't available to you" })).toBeVisible();
    await expect(rider.getByText(groupName)).toHaveCount(0);
  });

  await test.step("once in the group, the same link opens the ride itself", async () => {
    // The share page has no app chrome to join from — that is the point of it — so the rider goes
    // back to the app to enter the code, exactly as the "ask for the invite link" copy tells them.
    await rider.goto("/");
    await joinGroupByCode(rider, groupCode);
    await rider.goto(shareUrl);
    await rider.waitForURL(/\/app\?g=[^&]+&trip=/, { timeout: 10_000 });
    await expect(rider.locator(".ov")).toBeVisible({ timeout: 10_000 });
    await expect(rider.getByText("Request to join")).toBeVisible({ timeout: 10_000 });
  });

  await test.step("closing the ride drops ?trip= so a refresh doesn't reopen it", async () => {
    await rider.locator(".ov .iconbtn").first().click();
    await expect(rider).toHaveURL(/\/app(\?g=[^&]*)?$/);
  });

  await driverContext.close();
  await riderContext.close();
});
