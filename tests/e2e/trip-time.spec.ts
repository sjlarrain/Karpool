import { test, expect } from "@playwright/test";
import { E2E_DRIVER_EMAIL, E2E_PASSWORD } from "./global-setup";
import { createGroup, publishTrip, signIn } from "./helpers";

// Regression: a trip published for 7:45 read back as 14:45 in production. Trip instants are stored
// as timestamptz (correct); it was the *rendering* that used the runtime's own clock, and the
// runtime on Vercel is UTC — so every time on every card was shifted by the reader's UTC offset.
//
// The browser context is pinned to a zone that is neither UTC nor (usually) the machine running
// the suite, so this fails for any renderer that formats in its own zone instead of the reader's —
// which is exactly what a UTC production server does.
const ZONE = "Europe/Madrid";

test.use({ timezoneId: ZONE });

test("a published trip reads back at the time it was published for", async ({ page }) => {
  await signIn(page, E2E_DRIVER_EMAIL, E2E_PASSWORD);
  await createGroup(page, `E2E TZ ${Date.now()}`);

  const { displayTime } = await publishTrip(page, 90, ZONE);

  // Client-rendered, straight after the publish...
  const card = page.locator(".card").first();
  await expect(card).toContainText(displayTime, { timeout: 10_000 });

  // ...and again after a full server render, which is where the bug actually lived.
  await page.reload();
  await expect(page.locator(".card").first()).toContainText(displayTime, { timeout: 10_000 });
});
