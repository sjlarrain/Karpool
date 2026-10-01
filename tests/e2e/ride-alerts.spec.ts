import { test, expect } from "@playwright/test";
import { E2E_DRIVER_EMAIL, E2E_RIDER_EMAIL, E2E_PASSWORD } from "./global-setup";
import { adminClient, createGroup, getGroupCode, groupIdByName, joinGroupByCode, publishTrip, signIn, wallClock } from "./helpers";

// D-64 — a rider opts in to ride alerts from the You tab; when the driver publishes a ride at the
// rider's usual time, the rider is told and the driver is not.

test("ride alerts: an opted-in rider is told about a ride at their usual time", async ({ browser }) => {
  test.setTimeout(150_000);
  // Alerts are workdays only, and the ride is published an hour from now.
  const at = new Date(Date.now() + 60 * 60_000);
  test.skip([0, 6].includes(at.getDay()), "ride alerts only cover Monday to Friday");

  const admin = adminClient();
  const driverContext = await browser.newContext();
  const riderContext = await browser.newContext();
  const driver = await driverContext.newPage();
  const rider = await riderContext.newPage();
  const groupName = `E2E Alerts ${Date.now()}`;
  const usual = wallClock(60); // the rider's usual time: exactly when the ride will leave

  await test.step("driver creates a group, rider joins it", async () => {
    await signIn(driver, E2E_DRIVER_EMAIL, E2E_PASSWORD);
    await createGroup(driver, groupName);
    const code = await getGroupCode(driver);
    await signIn(rider, E2E_RIDER_EMAIL, E2E_PASSWORD);
    await joinGroupByCode(rider, code);
  });

  await test.step("rider turns ride alerts on with today's usual time", async () => {
    await rider.locator(".tab", { hasText: "You" }).click();
    await rider.getByRole("button", { name: /Ride alerts/ }).click();
    await expect(rider.getByRole("heading", { name: "Ride alerts" })).toBeVisible({ timeout: 10_000 });
    await rider.locator(".segb", { hasText: "On" }).click();
    await rider.getByLabel("Monday, to work").fill(usual.time);
    await rider.getByRole("button", { name: "Copy Monday to all" }).click();
    await rider.locator(".segb", { hasText: "± 15 min" }).click();
    await rider.locator("button.btnP", { hasText: "Save" }).click();
    await expect(rider.getByText("Ride alerts on")).toBeVisible({ timeout: 10_000 });
  });

  const since = new Date().toISOString();
  let published = usual;
  await test.step("driver publishes a ride at that time", async () => {
    published = await publishTrip(driver, 60);
    await expect(driver.getByText("YOU'RE DRIVING")).toBeVisible({ timeout: 10_000 });
  });

  await test.step("the rider is alerted and the driver is not", async () => {
    const groupId = await groupIdByName(groupName);
    const { data: trip } = await admin.from("trip").select("id").eq("group_id", groupId).is("parent_trip_id", null).single();
    const { data: alerts } = await admin
      .from("notification")
      .select("profile_id, title, body")
      .eq("type", "alert")
      .contains("payload", { tripId: trip!.id })
      .gte("created_at", since);
    expect(alerts).toHaveLength(1);
    expect(alerts![0]!.title).toBe("A ride at your usual time");
    // The time the ride was really published for — a minute can pass between setting up the rider
    // and publishing, so the time computed up front is only the rider's usual time, within slack.
    expect(alerts![0]!.body).toContain(published.displayTime);
    expect(alerts![0]!.body).toContain("3 seats free");

    const { data: driverRow } = await admin.from("trip").select("driver_id").eq("id", trip!.id).single();
    expect(alerts![0]!.profile_id).not.toBe(driverRow!.driver_id);
  });

  await test.step("the alert is in the rider's bell", async () => {
    await rider.reload();
    await rider.getByRole("button", { name: /Notifications/ }).click();
    await expect(rider.getByText("A ride at your usual time").first()).toBeVisible({ timeout: 10_000 });
  });

  await test.step("a full ride that gets a seat back alerts the rider again", async () => {
    const groupId = await groupIdByName(groupName);
    const { data: trip } = await admin.from("trip").select("id, driver_id").eq("group_id", groupId).is("parent_trip_id", null).single();
    // Make the car full: one seat, held by a name-only guest the driver added.
    await admin.from("trip").update({ capacity: 1 }).eq("id", trip!.id);
    const seated = await admin.from("trip_rider").insert({
      trip_id: trip!.id,
      guest_name: "E2E Guest",
      state: "joined",
      added_by_profile_id: trip!.driver_id,
      wants_return: false,
    });
    expect(seated.error).toBeNull();

    // The driver adds a seat through the real edit screen.
    await driver.reload();
    await driver.locator(".card", { hasText: published.displayTime }).first().click();
    await driver.getByText("Edit trip").click();
    await driver.getByRole("button", { name: "One seat more" }).click();
    const saved = driver.waitForResponse(
      (r) => /\/api\/trips\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === "PATCH",
    );
    await driver.getByText("Save changes").click();
    const body = await (await saved).json();
    expect(body.changed).toContain("capacity");
    expect(body.seatAlerted).toBe(1);

    const { data: alerts } = await admin
      .from("notification")
      .select("title, body")
      .eq("type", "alert")
      .eq("title", "A seat opened at your usual time")
      .contains("payload", { tripId: trip!.id });
    expect(alerts).toHaveLength(1);
    expect(alerts![0]!.body).toContain(published.displayTime);
    expect(alerts![0]!.body).toContain("1 seat free");
  });

  await test.step("rider turns alerts back off (the seeded account is shared by every spec)", async () => {
    await rider.keyboard.press("Escape").catch(() => undefined);
    await rider.reload();
    await rider.locator(".tab", { hasText: "You" }).click();
    await rider.getByRole("button", { name: /Ride alerts/ }).click();
    await rider.locator(".segb", { hasText: "Off" }).click();
    await rider.locator("button.btnP", { hasText: "Save" }).click();
    await expect(rider.getByText("Ride alerts off")).toBeVisible({ timeout: 10_000 });
  });

  await driverContext.close();
  await riderContext.close();
});
