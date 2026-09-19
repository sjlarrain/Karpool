import { test, expect } from "@playwright/test";
import { E2E_DRIVER_EMAIL, E2E_RIDER_EMAIL, E2E_PASSWORD } from "./global-setup";
import {
  createGroup,
  getGroupCode,
  joinGroupByCode,
  signIn,
  publishTrip,
  joinTrip,
  ageTripsInGroup,
  runCronTick,
  groupIdByName,
} from "./helpers";

// G5 — the core loop, driven through the real UI (not the API directly): sign in, publish a trip,
// a second account joins it, the ride happens by itself, the rider gives kudos, and the leaderboard
// reflects it. Uses the two fixed seeded accounts from global-setup.ts rather than signing up fresh
// ones per run (Supabase's signup email rate limit makes that impractical).
//
// D-61: there is no Start and no Close to click. The trip is aged past its departure and one cron
// tick is run — the same route pg_cron calls in production — and that is what makes the ride count.

test("core loop: publish, join, settle, kudos, leaderboard", async ({ browser, baseURL }) => {
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

  await test.step("the ride settles itself once its departure passes", async () => {
    // What production does every five minutes, compressed: move the trip into the past, then run
    // one tick. Nobody taps anything.
    await ageTripsInGroup(await groupIdByName(groupName));
    const tick = await runCronTick(baseURL!);
    // Both legs of the round trip: the outbound settles, which materialises the return leg, and the
    // return is already in the past too, so the same tick settles it as well.
    expect(tick.settled).toBeGreaterThanOrEqual(1);

    // D-61: a settled ride stays on the LIVE feed until its day is over — its kudos button and the
    // driver's "fix the list" both live on that card, so hiding it at the moment it departs would
    // hide the only two things left to do with it.
    await driver.reload();
    await expect(driver.locator(".card", { hasText: trip.displayTime }).first()).toBeVisible({ timeout: 10_000 });
    await expect(driver.getByText("COMPLETED").first()).toBeVisible();
  });

  await test.step("rider gives kudos", async () => {
    await rider.reload();
    // Still on the live feed (D-61), badged COMPLETED — the ride left minutes ago, and the card is
    // where the rider thanks their driver.
    await rider.locator(".card", { hasText: trip.displayTime }).first().click();
    await expect(rider.getByText("Rate your ride")).toBeVisible({ timeout: 10_000 });
    // D-18: the kudos toggle starts off, so the submit reads "Skip & close" until the rider opts in.
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
