import { test, expect } from "@playwright/test";
import { E2E_DRIVER_EMAIL, E2E_RIDER_EMAIL, E2E_PASSWORD } from "./global-setup";
import { createGroup, getGroupCode, joinGroupByCode, signIn, publishTrip, joinTrip } from "./helpers";

// G5 — the core loop, driven through the real UI (not the API directly): sign in, publish a trip,
// a second account joins it, the driver starts and closes it, the rider gives kudos, and the
// leaderboard reflects it. Uses the two fixed seeded accounts from global-setup.ts rather than
// signing up fresh ones per run (Supabase's signup email rate limit makes that impractical).

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

  const trip = await test.step("driver publishes a trip departing soon", async () => {
    const published = await publishTrip(driver);
    await expect(driver.getByText("YOU'RE DRIVING")).toBeVisible({ timeout: 10_000 });
    return published;
  });

  await test.step("rider signs in and joins the group", async () => {
    await signIn(rider, E2E_RIDER_EMAIL, E2E_PASSWORD);
    await joinGroupByCode(rider, groupCode);
    await expect(rider.getByText(groupName).first()).toBeVisible();
  });

  await test.step("rider joins the trip", async () => {
    await rider.locator(".tab", { hasText: "Carpools" }).click();
    await joinTrip(rider, rider.locator(".card", { hasText: trip.displayTime }).first());
  });

  await test.step("driver starts and closes the trip, confirming the rider", async () => {
    const detailLoaded = driver.waitForResponse((r) => /\/api\/trips\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "GET");
    await driver.locator(".card").first().click();
    await detailLoaded;
    const started = driver.waitForResponse((r) => r.url().includes("/start") && r.request().method() === "POST");
    await driver.getByText("Start trip · get your points").click({ timeout: 15_000 });
    await started;
    // D-56: the award is written by /start now, so the toast carries the figure and the screen says
    // the driver has nothing left to do. Asserting the "+13 pts" here is the whole point of the
    // change — a green "Trip started" would pass just as happily on the old behaviour, which paid
    // nobody until someone remembered to close.
    await expect(driver.getByText("+13 pts")).toBeVisible({ timeout: 10_000 });
    await expect(driver.getByText("Trip in progress")).toBeVisible({ timeout: 10_000 });
    await expect(driver.getByText("Your points are already in")).toBeVisible();
    await driver.getByText("End trip now").click();
    await expect(driver.getByRole("heading", { name: "End trip" })).toBeVisible();
    await driver.locator("button.btnP", { hasText: "End trip & notify riders" }).click();
    // No "+N" in this toast: the roster at close matches the roster at start, so the close moved
    // nothing. That is D-56's normal case, and it is worth asserting that it stays quiet.
    await expect(driver.getByText("Trip closed")).toBeVisible({ timeout: 10_000 });
    await driver.locator(".ov .iconbtn").first().click(); // back out of the trip detail overlay
  });

  await test.step("rider gives kudos", async () => {
    await rider.reload();
    // Not `.card` first(): closing a round trip materialises the return leg (D-35), so the feed now
    // holds a live back trip *above* the closed outbound this step is about.
    //
    // And the outbound is no longer in the live feed at all. D-53 (shipped after this spec) puts a
    // closed trip behind a `Past · N` toggle that starts collapsed, so the kudos prompt lives one
    // tap deeper than it used to — which is worth walking through here rather than routing around,
    // because it is the path a real rider takes to leave kudos on a ride that is over.
    await rider.getByText(/^Past · \d+$/).click();
    await rider.locator(".card", { hasText: trip.displayTime }).first().click();
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
