import { test, expect } from "@playwright/test";
import { E2E_DRIVER_EMAIL, E2E_RIDER_EMAIL, E2E_PASSWORD } from "./global-setup";
import {
  adminClient,
  ageTripsInGroup,
  createGroup,
  getGroupCode,
  groupIdByName,
  joinGroupByCode,
  joinTrip,
  openSection,
  publishTrip,
  runCronTick,
  signIn,
  wallClock,
} from "./helpers";

// D-63 — a ride counts itself at its departure time (D-61), but the driver never left. They
// postpone it to later the same day: the points it paid (and the kudos it received) are rolled
// back, the rider keeps their seat, and when the new time comes it counts once.

test("postpone: a counted ride is rolled back, moved, and counts once at the new time", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const driverContext = await browser.newContext();
  const riderContext = await browser.newContext();
  const driver = await driverContext.newPage();
  const rider = await riderContext.newPage();
  const groupName = `E2E Postpone ${Date.now()}`;

  // The new time has to still be today: a run in the last hour of the day cannot postpone at all.
  const newSlot = wallClock(30);
  if (newSlot.date !== wallClock(0).date) {
    throw new Error("Run this spec before 23:30 local — a postpone has to land later the same day.");
  }

  await test.step("driver publishes, rider joins", async () => {
    await signIn(driver, E2E_DRIVER_EMAIL, E2E_PASSWORD);
    await createGroup(driver, groupName);
    const code = await getGroupCode(driver);
    const published = await publishTrip(driver);
    await signIn(rider, E2E_RIDER_EMAIL, E2E_PASSWORD);
    await joinGroupByCode(rider, code);
    await rider.locator(".tab", { hasText: "Carpools" }).click();
    await joinTrip(rider, rider.locator(".card", { hasText: published.displayTime }).first());
  });

  const groupId = await groupIdByName(groupName);
  const { data: outbound } = await admin
    .from("trip")
    .select("id")
    .eq("group_id", groupId)
    .is("parent_trip_id", null)
    .single();
  const tripId = outbound!.id as string;

  const tripLedgerTotal = async () => {
    const { data } = await admin.from("points_ledger").select("points").eq("trip_id", tripId);
    return (data ?? []).reduce((sum, row) => sum + (row.points as number), 0);
  };

  let settledTime = "";
  await test.step("the ride counts itself and the rider gives kudos", async () => {
    ({ displayTime: settledTime } = await ageTripsInGroup(groupId));
    await runCronTick(baseURL!);
    await rider.reload();
    await openSection(rider, "Completed today");
    await rider.locator(".card", { hasText: settledTime }).first().click();
    await rider.getByRole("button", { name: /Give kudos/ }).click();
    await rider.locator("button.btnP", { hasText: "Send kudos" }).click();
    await expect(rider.getByText("Kudos sent to")).toBeVisible({ timeout: 10_000 });
    // drive 10 + one seat 3, and a kudos on a one-rider car 2.
    expect(await tripLedgerTotal()).toBe(15);
  });

  await test.step("the driver postpones it to later today", async () => {
    await driver.reload();
    await openSection(driver, "Completed today");
    await driver.locator(".card", { hasText: settledTime }).first().click();
    await driver.getByRole("button", { name: "Postpone", exact: true }).click();
    await expect(driver.getByRole("heading", { name: `Couldn't leave at ${settledTime}?` })).toBeVisible();
    await driver.locator(".sheetc input[type=time]").fill(newSlot.time);
    await driver.locator("button.btnP", { hasText: "Postpone ride" }).click();
    await expect(driver.getByText(/Ride moved/)).toBeVisible({ timeout: 10_000 });
  });

  await test.step("everything the count did is rolled back", async () => {
    const { data: trip } = await admin.from("trip").select("status, depart_at, postponed_at").eq("id", tripId).single();
    expect(trip!.status).toBe("scheduled");
    expect(trip!.postponed_at).not.toBeNull();
    expect(Math.abs(new Date(trip!.depart_at as string).getTime() - (Date.now() + 30 * 60_000))).toBeLessThan(3 * 60_000);

    expect(await tripLedgerTotal()).toBe(0);
    const { count: voids } = await admin
      .from("points_ledger")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", tripId)
      .eq("kind", "postpone_void");
    expect(voids).toBe(2); // the drive row and the kudos row

    const { count: kudos } = await admin.from("kudos").select("id", { count: "exact", head: true }).eq("trip_id", tripId);
    expect(kudos).toBe(0);

    const { data: seats } = await admin.from("trip_rider").select("state, penalty_waived_at, profile_id").eq("trip_id", tripId);
    expect(seats).toHaveLength(1);
    expect(seats![0]!.state).toBe("joined");
    expect(seats![0]!.penalty_waived_at).not.toBeNull();

    const { count: told } = await admin
      .from("notification")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", seats![0]!.profile_id as string)
      .eq("title", "Ride postponed")
      .contains("payload", { tripId });
    expect(told).toBe(1);
  });

  await test.step("it is back among the rides still ahead, at the new time", async () => {
    await rider.reload();
    await expect(rider.locator(".card", { hasText: newSlot.displayTime }).first()).toBeVisible({ timeout: 10_000 });
  });

  await test.step("at the new time it counts once", async () => {
    await admin
      .from("trip")
      .update({ depart_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", tripId);
    await runCronTick(baseURL!);
    const { data: trip } = await admin.from("trip").select("status").eq("id", tripId).single();
    expect(trip!.status).toBe("closed");
    // Paid again for the one seat, with no kudos yet: 13, not 13 on top of the first payment.
    expect(await tripLedgerTotal()).toBe(13);
    const { count: driveRows } = await admin
      .from("points_ledger")
      .select("id", { count: "exact", head: true })
      .eq("trip_id", tripId)
      .eq("kind", "drive");
    expect(driveRows).toBe(2); // the voided one and the new one — the tiles count only the live one
  });

  await driverContext.close();
  await riderContext.close();
});
