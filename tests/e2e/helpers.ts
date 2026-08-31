import { expect, type Locator, type Page } from "@playwright/test";

// Shared journey steps for the e2e specs: signing in with the fixed seeded accounts, standing up a
// group, and joining one by code. Extracted from core-loop.spec.ts when the share-link spec needed
// the same opening moves.

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByPlaceholder("you@company.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(password);
  await page.locator("button.btnP", { hasText: "Sign in" }).click();
  // Post-signin lands on "/" either way — LockedGate (no group yet) or a redirect to /app (has a
  // group) — wait for whichever settled destination actually renders.
  await page.locator(".tabbar, h2:has-text('No group yet')").first().waitFor({ state: "visible", timeout: 10_000 });
}

export async function createGroup(page: Page, groupName: string) {
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

export async function getGroupCode(page: Page): Promise<string> {
  await page.locator(".tab", { hasText: "Group" }).click();
  const codeText = await page.getByText(/^[A-Z0-9]{6}$/).first().innerText();
  return codeText.trim();
}

export async function joinGroupByCode(page: Page, code: string) {
  // The switch-group sheet joins in the background and then pushes /app?g=<new id>. Waiting for a
  // bare /\/app/ matched the page the rider was *already* on, so the spec raced ahead of the join
  // and the next step saw a non-member. Remember where we started so we can wait for the move.
  const urlBefore = page.url();
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
  await page.waitForURL((url) => /\/app/.test(url.href) && url.href !== urlBefore, { timeout: 10_000 });
}

// A wall clock `minutesFromNow` from now, in the shape the form's three fields speak: a
// `<input type=date>` value, an `<input type=time>` value, and the same moment as a card renders it
// ("7:45", no leading zero). Both halves come off ONE instant, so a run near midnight rolls onto
// tomorrow rather than filling today's date with tomorrow's time. Shared by publishTrip and by any
// spec that has to move a departure after the fact (D-38's edit).
export function wallClock(
  minutesFromNow: number,
  timeZone?: string,
): { date: string; time: string; displayTime: string } {
  const at = new Date(Date.now() + minutesFromNow * 60_000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
    displayTime: `${Number(part("hour"))}:${part("minute")}`,
  };
}

// Publishes a trip departing `minutesFromNow` from now, deriving BOTH the day and the time from
// the same instant so a run near midnight rolls onto tomorrow instead of publishing into the past.
//
// The fixed "07:45 today" this replaces was only ever accidentally valid: any run after 07:45 was
// publishing a trip whose departure had passed. Nothing complained until D-23 stopped people
// joining a ride that has already left — the specs were relying on a bug. The default of 60 minutes
// keeps the trip inside the T-2h start window (D-16) and still ahead of now, so the same trip is
// both joinable and startable.
//
// `timeZone` is the zone the *browser context* is in (Playwright's `timezoneId`), because that is
// the zone the form's date/time inputs speak; it defaults to this machine's. Returns what was
// filled in plus `displayTime` — the same wall clock as the app renders it on a card ("7:45", no
// leading zero) — so a spec can assert the ride reads back at the time it was published for.
export async function publishTrip(
  page: Page,
  minutesFromNow = 60,
  timeZone?: string,
): Promise<{ date: string; time: string; displayTime: string }> {
  const { date, time, displayTime } = wallClock(minutesFromNow, timeZone);

  await page.locator(".tab", { hasText: "Carpools" }).click();
  await page.locator(".fab").click();
  await page.locator("input[type=date]").first().fill(date);
  await page.locator("input[type=time]").first().fill(time);
  await page.locator("button.btnP", { hasText: "Publish to" }).click();

  return { date, time, displayTime };
}

// D-35 answer (C): joining a **round** trip asks "Coming back too?" before the join is submitted,
// with no default and no way past it. `publishTrip` leaves the create form on its "Round trip"
// default, so every join in this suite meets that sheet — the specs were clicking "Request to
// join" and then waiting for a confirmation that could never arrive while the question was still
// on screen.
export async function joinTrip(page: Page, card: Locator, wantsReturn = false) {
  await card.click();
  await expect(page.getByText("Request to join")).toBeVisible({ timeout: 10_000 });
  await page.getByText("Request to join").click();

  const question = page.getByRole("heading", { name: "Coming back too?" });
  if (await question.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await page.getByText(wantsReturn ? "Yes, both ways" : "Just the way there").click();
  }

  await expect(page.getByText(/riding this trip/)).toBeVisible({ timeout: 10_000 });
}
