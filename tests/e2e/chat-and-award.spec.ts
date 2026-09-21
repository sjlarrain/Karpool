import { test, expect, type Page } from "@playwright/test";
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

// D-61 and D-57, driven through the real UI: a ride that pays itself at its departure, a chat that
// stays open while it is happening, and the driver reporting a rider who never got in.
//
// Both features are here in one spec because they share the setup that makes either meaningful: a
// live trip with a driver and a rider actually on it. Splitting them would double a two-account,
// two-context, fresh-group fixture to assert half as much.
//
// The group is created fresh per run, so the leaderboard figures below are the whole history of it
// — 13 and 10 mean what they say, rather than "13 more than whatever was already there".

async function openOwnTrip(page: Page, displayTime: string) {
  await page.locator(".tab", { hasText: "Carpools" }).click();
  await page.locator(".card", { hasText: displayTime }).first().click();
  await expect(page.locator(".ov")).toBeVisible({ timeout: 10_000 });
}

async function openChat(page: Page) {
  const loaded = page.waitForResponse(
    (r) => r.url().includes("/messages") && r.request().method() === "GET",
  );
  await page.getByText("Trip chat").click();
  await loaded;
}

test("a ride settles itself, the car talks, and a no-show is reported", async ({ browser, baseURL }) => {
  // The longest journey in the suite — two people, a chat both ways, a settle, a no-show report and
  // the leaderboard — and it ran at 80-90% of the config's 90s even on a warm dev server, so any
  // slowdown (a cold compile, a busy database) failed it at whichever step the clock ran out on.
  // Measured at ~1.3m warm and ~1.8m cold; this budget covers both with room.
  test.setTimeout(180_000);
  const driverContext = await browser.newContext();
  const riderContext = await browser.newContext();
  const driver = await driverContext.newPage();
  const rider = await riderContext.newPage();

  const groupName = `E2E Chat ${Date.now()}`;

  // 45 minutes out, so the trip is publishable and joinable before it is aged into the past.
  const trip = await test.step("driver publishes, rider joins", async () => {
    await signIn(driver, E2E_DRIVER_EMAIL, E2E_PASSWORD);
    await createGroup(driver, groupName);
    const published = await publishTrip(driver, 45);
    await expect(driver.getByText("YOU'RE DRIVING")).toBeVisible({ timeout: 10_000 });

    const code = await getGroupCode(driver);
    await signIn(rider, E2E_RIDER_EMAIL, E2E_PASSWORD);
    await joinGroupByCode(rider, code);
    await joinTrip(rider, rider.locator(".card", { hasText: published.displayTime }).first());
    await rider.locator(".ov .iconbtn").first().click();
    return published;
  });

  await test.step("nothing on screen starts the ride — the scheduler does, and it pays", async () => {
    await openOwnTrip(driver, trip.displayTime);
    await expect(driver.getByText(/counts itself at/)).toBeVisible({ timeout: 10_000 });
    await expect(driver.getByText("Start trip")).toHaveCount(0);
    await driver.locator(".ov .iconbtn").first().click();
  });

  // ─── D-57 ────────────────────────────────────────────────────────────────
  await test.step("the driver tells the car where they are", async () => {
    await openOwnTrip(driver, trip.displayTime);
    await openChat(driver);
    await expect(driver.getByText("Nothing said yet")).toBeVisible();

    const sent = driver.waitForResponse((r) => r.url().includes("/messages") && r.request().method() === "POST");
    // A quick chip, which is the path the developer's own examples describe — one tap, no typing
    // while holding a steering wheel.
    await driver.getByText("I'll wait for you here").click();
    const body = await (await sent).json();
    // The rider is on this trip and is not the author, so exactly one person is told.
    expect(body.notified).toBe(1);
    expect(body.notifyError).toBeNull();

    // Scoped to the thread: the same words are also on the quick-reply chip in the footer, and an
    // unscoped match would pass on a chip that was never sent.
    await expect(driver.locator(".ov .scroll").getByText("I'll wait for you here")).toBeVisible({ timeout: 10_000 });
  });

  await test.step("the rider reads it and answers", async () => {
    await rider.reload();
    await openOwnTrip(rider, trip.displayTime);
    await openChat(rider);
    await expect(rider.locator(".ov .scroll").getByText("I'll wait for you here")).toBeVisible({ timeout: 10_000 });

    const replied = rider.waitForResponse((r) => r.url().includes("/messages") && r.request().method() === "POST");
    await rider.locator("textarea").fill("Two minutes, coming down now");
    await rider.locator("button.btnP", { hasText: "Send" }).click();
    await replied;
    await expect(rider.locator(".ov .scroll").getByText("Two minutes, coming down now")).toBeVisible({ timeout: 10_000 });
  });

  await test.step("the message reached the driver, on the thread and in the bell", async () => {
    // The thread polls every 12s, but a reopen is deterministic and does not spend that time.
    await driver.reload();
    await openOwnTrip(driver, trip.displayTime);
    await openChat(driver);
    await expect(driver.locator(".ov .scroll").getByText("Two minutes, coming down now")).toBeVisible({ timeout: 10_000 });

    const res = await driver.request.get("/api/notifications");
    const { notifications } = await res.json();
    const chat = notifications.filter((n: { type: string }) => n.type === "comment");
    expect(chat.length).toBe(1);
    // The push carries the message itself, not "you have a new message" — the whole value of
    // "I'm here" is being readable from a lock screen.
    expect(chat[0].body).toBe("Two minutes, coming down now");
  });

  // ─── D-61, the settle and the correction ────────────────────────────────
  // Ageing the trip rewrites its departure, so every card lookup after it uses this time.
  let settledTime = "";
  await test.step("the departure time pays the driver, with no tap from anyone", async () => {
    ({ displayTime: settledTime } = await ageTripsInGroup(await groupIdByName(groupName)));
    await runCronTick(baseURL!);

    await driver.reload();
    await driver.locator(".tab", { hasText: "Ranks" }).click();
    await expect(driver.getByText("Leaderboard")).toBeVisible({ timeout: 10_000 });
    // 10 for driving + 3 for the one filled seat. Before D-61 this ride would have paid nothing at
    // all unless someone remembered to press two buttons.
    await expect(driver.getByText("13", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  await test.step("the driver reports the rider who never got in", async () => {
    await openOwnTrip(driver, settledTime);
    await driver.getByText("Fix the ride list").click();
    await expect(driver.getByRole("heading", { name: "Fix the ride list" })).toBeVisible();

    const reported = driver.waitForResponse((r) => r.url().includes("/no-show") && r.request().method() === "POST");
    await driver.getByText("Didn't show").click();
    // Two taps, because there is no undo: the ledger is append-only.
    await driver.getByRole("button", { name: "Report no-show" }).click();
    const body = await (await reported).json();
    expect(body.riderPoints).toBe(-5);
    expect(body.driverPoints).toBe(2);
  });

  await test.step("the leaderboard follows: the driver keeps the seat and gains the report bonus", async () => {
    await driver.reload();
    await driver.locator(".tab", { hasText: "Ranks" }).click();
    await expect(driver.getByText("Leaderboard")).toBeVisible({ timeout: 10_000 });
    // 13 + 2. The seat's own 3 points stay: the driver held it and drove (D-61).
    await expect(driver.getByText("15", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  await driverContext.close();
  await riderContext.close();
});
