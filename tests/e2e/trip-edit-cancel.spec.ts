import { test, expect, type Page } from "@playwright/test";
import { E2E_DRIVER_EMAIL, E2E_RIDER_EMAIL, E2E_PASSWORD } from "./global-setup";
import { createGroup, getGroupCode, joinGroupByCode, signIn, publishTrip, joinTrip, wallClock } from "./helpers";

// D-38 — the driver's two ways out of a plan that stopped working, and the rider's.
//
// The whole point of the feature is a *negative*: leaving a trip that changed under you costs
// nothing. A test that only proves the second leave was free would pass just as happily if the
// penalty had never existed, so this spec charges the rider first on an unchanged trip, then has
// them rejoin the same trip and leave again after an edit. Same rider, same trip, same distance
// from departure — only the edit differs.
//
// Every trip here departs 30-45 minutes out, deliberately INSIDE the group's 60-minute
// late-cancellation window (D-10). Outside it, leaving is free anyway and proves nothing.

async function openTripCard(page: Page, displayTime: string) {
  await page.locator(".tab", { hasText: "Carpools" }).click();
  const card = page.locator(".card", { hasText: displayTime }).first();
  await card.click();
  await expect(page.locator(".ov")).toBeVisible({ timeout: 10_000 });
  return card;
}

async function leaveTrip(page: Page) {
  const left = page.waitForResponse(
    (r) => r.url().includes("/leave") && r.request().method() === "POST",
  );
  await page.getByText("Leave this carpool").click();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  return (await left).json();
}

test("edit and cancel: riders are told, and a changed trip costs nothing to leave", async ({ browser }) => {
  const driverContext = await browser.newContext();
  const riderContext = await browser.newContext();
  const driver = await driverContext.newPage();
  const rider = await riderContext.newPage();

  const groupName = `E2E Edit ${Date.now()}`;

  await test.step("driver signs in, creates a group, publishes a trip 30 minutes out", async () => {
    await signIn(driver, E2E_DRIVER_EMAIL, E2E_PASSWORD);
    await createGroup(driver, groupName);
    await expect(driver.getByText("YOU'RE DRIVING")).toBeHidden();
  });

  const groupCode = await getGroupCode(driver);
  const trip = await publishTrip(driver, 30);
  await expect(driver.getByText("YOU'RE DRIVING")).toBeVisible({ timeout: 10_000 });

  await test.step("rider joins the group and the trip", async () => {
    await signIn(rider, E2E_RIDER_EMAIL, E2E_PASSWORD);
    await joinGroupByCode(rider, groupCode);
    await rider.locator(".tab", { hasText: "Carpools" }).click();
    await joinTrip(rider, rider.locator(".card", { hasText: trip.displayTime }).first());
  });

  await test.step("baseline: leaving an UNCHANGED trip inside the window costs points", async () => {
    // The warning the rider is shown while the plan still stands.
    await expect(rider.getByText(/Drop out up to/)).toBeVisible();
    await expect(rider.getByText(/changed this trip/)).toBeHidden();

    const body = await leaveTrip(rider);
    expect(body.latePenalty).toBe(-5);
    expect(body.penaltyWaived).toBe(false);
  });

  await test.step("rider takes the same seat again", async () => {
    await rider.locator(".ov .iconbtn").first().click();
    await rider.reload();
    await joinTrip(rider, rider.locator(".card", { hasText: trip.displayTime }).first());
    await rider.locator(".ov .iconbtn").first().click();
  });

  await test.step("an untouched save changes nothing and notifies nobody", async () => {
    await openTripCard(driver, trip.displayTime);
    await driver.getByText("Edit trip").click();
    await expect(driver.getByRole("heading", { name: "Edit trip" })).toBeVisible();

    const saved = driver.waitForResponse(
      (r) => /\/api\/trips\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "PATCH",
    );
    await driver.getByText("Save changes").click();
    const body = await (await saved).json();
    expect(body.changed).toEqual([]);
    expect(body.notifiedRiders).toBe(0);
  });

  const moved = wallClock(45);

  await test.step("driver moves the departure and the rider is notified", async () => {
    await driver.getByText("Edit trip").click();
    await driver.locator(".ov input[type=date]").last().fill(moved.date);
    await driver.locator(".ov input[type=time]").first().fill(moved.time);

    const saved = driver.waitForResponse(
      (r) => /\/api\/trips\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "PATCH",
    );
    await driver.getByText("Save changes").click();
    const body = await (await saved).json();
    expect(body.changed).toContain("departAt");
    expect(body.notifiedRiders).toBe(1);
  });

  await test.step("the rider is told the plan moved, and told it is free to walk away", async () => {
    await rider.reload();
    await openTripCard(rider, moved.displayTime);
    await expect(rider.getByText(/changed this trip/)).toBeVisible({ timeout: 10_000 });
    await expect(rider.getByText(/no points lost/)).toBeVisible();
    // The threat is gone, not merely covered up by the notice above it.
    await expect(rider.getByText(/Drop out up to/)).toBeHidden();
  });

  await test.step("leaving the changed trip costs the rider nothing", async () => {
    const body = await leaveTrip(rider);
    expect(body.latePenalty).toBeNull();
    expect(body.penaltyWaived).toBe(true);
  });

  // ─── cancelling ───────────────────────────────────────────────────────────
  const second = await test.step("driver publishes a second trip and the rider joins it", async () => {
    await driver.locator(".ov .iconbtn").first().click();
    const published = await publishTrip(driver, 40);
    await rider.reload();
    await joinTrip(rider, rider.locator(".card", { hasText: published.displayTime }).first());
    await rider.locator(".ov .iconbtn").first().click();
    return published;
  });

  await test.step("driver cancels it with a reason", async () => {
    await openTripCard(driver, second.displayTime);
    await driver.getByText("Cancel trip").click();
    await expect(driver.getByRole("heading", { name: "Cancel this trip?" })).toBeVisible();
    await driver.locator(".sheetc textarea").fill("Car's in the shop");

    const cancelled = driver.waitForResponse(
      (r) => r.url().includes("/cancel") && r.request().method() === "POST",
    );
    await driver.locator(".sheetc button.btnP", { hasText: "Cancel trip" }).click();
    const body = await (await cancelled).json();
    expect(body.notifiedRiders).toBe(1);
    await expect(driver.getByText("This trip was cancelled")).toBeVisible({ timeout: 10_000 });
  });

  await test.step("the rider sees what happened and why, and is offered nothing to leave", async () => {
    await rider.reload();
    await openTripCard(rider, second.displayTime);
    await expect(rider.getByText("This trip was cancelled")).toBeVisible({ timeout: 10_000 });
    await expect(rider.getByText(/Car's in the shop/)).toBeVisible();
    await expect(rider.getByText(/Nobody lost points/)).toBeVisible();
    // The bug this replaced: a cancelled trip still said "you're riding this" over a Leave button
    // the API answers with 409.
    await expect(rider.getByText("Leave this carpool")).toBeHidden();
    await expect(rider.getByText(/riding this trip/)).toBeHidden();
  });

  await test.step("both notifications actually reached the rider", async () => {
    const res = await rider.request.get("/api/notifications");
    const { notifications } = await res.json();
    const titles = notifications.map((n: { title: string }) => n.title);
    expect(titles).toContain("Departure changed");
    expect(titles).toContain("Trip cancelled");
    const cancellation = notifications.find((n: { title: string }) => n.title === "Trip cancelled");
    expect(cancellation.body).toContain("Car's in the shop");
  });

  await driverContext.close();
  await riderContext.close();
});
