import { test, expect, type Page } from "@playwright/test";
import { E2E_DRIVER_EMAIL, E2E_RIDER_EMAIL, E2E_PASSWORD } from "./global-setup";
import { createGroup, getGroupCode, joinGroupByCode, signIn, publishTrip, joinTrip } from "./helpers";

// D-56 and D-57, driven through the real UI.
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

test("start pays the driver, the roster corrects it, and the car can talk to itself", async ({ browser }) => {
  const driverContext = await browser.newContext();
  const riderContext = await browser.newContext();
  const driver = await driverContext.newPage();
  const rider = await riderContext.newPage();

  const groupName = `E2E Chat ${Date.now()}`;

  // 45 minutes out: inside the T-2h start window (D-16) so the trip can actually be started, and
  // inside the 60-minute late-cancellation window (D-10) so the rider's leave is the real,
  // penalised kind rather than a free one.
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

  // ─── D-56 ────────────────────────────────────────────────────────────────
  await test.step("starting the trip pays the driver on the spot", async () => {
    await openOwnTrip(driver, trip.displayTime);
    const started = driver.waitForResponse((r) => r.url().includes("/start") && r.request().method() === "POST");
    await driver.getByText("Start trip · get your points").click({ timeout: 15_000 });

    // The figure comes off the route, not off the screen: 10 for driving + 3 for the one filled
    // seat. This is the assertion the whole change exists for — before D-56 this response paid
    // nothing at all and the ledger stayed empty until someone remembered to close.
    const body = await (await started).json();
    expect(body.pointsAwarded).toBe(13);
    expect(body.awardError).toBeNull();

    await expect(driver.getByText("+13 pts")).toBeVisible({ timeout: 10_000 });
    await expect(driver.getByText("Your points are already in")).toBeVisible();
  });

  await test.step("the driver's score is on the leaderboard before anyone has closed anything", async () => {
    await driver.locator(".ov .iconbtn").first().click();
    await driver.locator(".tab", { hasText: "Ranks" }).click();
    await expect(driver.getByText("Leaderboard")).toBeVisible({ timeout: 10_000 });
    await expect(driver.getByText("13", { exact: true }).first()).toBeVisible();
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

  // ─── D-56, the correcting half ───────────────────────────────────────────
  await test.step("a rider leaving a started trip takes their seat's bonus back off the driver", async () => {
    await rider.reload();
    await openOwnTrip(rider, trip.displayTime);
    const left = rider.waitForResponse((r) => r.url().includes("/leave") && r.request().method() === "POST");
    await rider.getByText("Leave this carpool").click();
    await rider.getByRole("button", { name: "Leave", exact: true }).click();
    const body = await (await left).json();

    // Both sides of one event, in one response: the rider is charged the late-cancellation penalty
    // they always were, and the driver — who was paid for a fuller car 20 lines ago — gives the
    // seat's 3 points back.
    expect(body.latePenalty).toBe(-5);
    expect(body.driverPointsAdjusted).toBe(-3);
    expect(body.awardError).toBeNull();
  });

  await test.step("the leaderboard follows", async () => {
    await driver.reload();
    await driver.locator(".tab", { hasText: "Ranks" }).click();
    await expect(driver.getByText("Leaderboard")).toBeVisible({ timeout: 10_000 });
    // 13 − 3. The append-only ledger now holds a `drive` row and a `drive_adjust` row, and the
    // driver is still credited with exactly ONE trip driven — a second `drive` row would have said
    // two, which is why the correction has a kind of its own.
    await expect(driver.getByText("10", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  await driverContext.close();
  await riderContext.close();
});
