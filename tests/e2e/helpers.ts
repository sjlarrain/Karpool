import fs from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

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
  await dismissWhatsNew(page);
}

/**
 * D-61's "what's new" sheet covers the app until it is closed, and since the developer asked for it
 * to appear TWICE it can come back on any later page load — after a `reload()`, after a redirect —
 * not only on the first visit. A one-shot dismissal after sign-in is therefore not enough: the
 * second showing lands mid-spec and silently eats the next click, which is exactly how four specs
 * failed the first time this suite ran.
 *
 * `addLocatorHandler` is Playwright's answer to an overlay that can appear at any moment: the
 * handler fires whenever the sheet turns up, closes it, and the action that was blocked carries on.
 * It stays armed for the life of the page, so no spec has to know where the second showing lands.
 */
export async function dismissWhatsNew(page: Page) {
  await page.addLocatorHandler(
    page.getByRole("button", { name: "Got it" }),
    async (gotIt) => {
      // The handler can fire again while its own first click is still in flight: "Got it" disables
      // itself until the seen-mark POST returns, and then the sheet unmounts. A plain click() then
      // waits on a disabled button that is about to detach, which hangs the whole spec — that is
      // how this failed the first time. So: click only if it is still clickable, then simply wait
      // for the sheet to be gone, and never let either step throw into the caller's action.
      if (await gotIt.isEnabled().catch(() => false)) {
        await gotIt.click({ timeout: 5_000 }).catch(() => {});
      }
      await page.locator(".sheet").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
    },
    { noWaitAfter: true },
  );
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
/**
 * A return time on the SAME day as `departTime` and strictly after it — two hours later, or the
 * last minute of the day when two hours would roll over midnight.
 *
 * Throws rather than publishing something the form will refuse: a round trip departing at 23:59 has
 * no same-day return to give it, which is a real limit of the create form (it offers one Day field
 * for both legs) and not something a test helper should paper over silently.
 */
export function sameDayReturn(departTime: string): string {
  const [h, m] = departTime.split(":").map(Number);
  const departMinutes = h! * 60 + m!;
  if (departMinutes >= 23 * 60 + 59) {
    throw new Error(
      `Cannot publish a round trip departing at ${departTime}: the create form gives both legs one Day, ` +
        "so there is no same-day return left. Run the suite outside the last minute of the day.",
    );
  }
  const returnMinutes = Math.min(departMinutes + 120, 23 * 60 + 59);
  return `${String(Math.floor(returnMinutes / 60)).padStart(2, "0")}:${String(returnMinutes % 60).padStart(2, "0")}`;
}

export async function publishTrip(
  page: Page,
  minutesFromNow = 60,
  timeZone?: string,
): Promise<{ date: string; time: string; displayTime: string }> {
  const { date, time, displayTime } = wallClock(minutesFromNow, timeZone);

  // The return time has to be set, not left on the form's 17:30 default.
  //
  // CreateTripOverlay builds a round trip's return from the SAME `departDate` as the departure, and
  // D-47 rejects a return at or before it. So a suite that publishes "60 minutes from now" and
  // never touches the return field is only valid before ~16:30 local — every run after that filled
  // the form with a 21:57 departure and a 17:30 return and was refused with "Return time must be
  // after departure", failing at the first assertion with no hint that the clock was the cause.
  // Nothing about the app was wrong; the helper was.
  const returnTime = sameDayReturn(time);

  await page.locator(".tab", { hasText: "Carpools" }).click();
  await page.locator(".fab").click();
  await page.locator("input[type=date]").first().fill(date);
  await page.locator("input[type=time]").first().fill(time);
  await page.locator("input[type=time]").nth(1).fill(returnTime);
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

// ─── D-61: making a ride "happen" inside a test ──────────────────────────────
//
// Nothing in the UI starts or ends a trip any more — the scheduler settles it once its departure
// has passed. A spec therefore ages the trip by hand and then runs one tick, which is exactly what
// production does every five minutes, through the same route.

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(__dirname, "../../.env.local");
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]!] = match[2]!;
  }
  return env;
}

export function adminClient() {
  const env = loadEnvLocal();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * Move a group's trips into the past so the next tick settles them, and return the time the cards
 * will now show.
 *
 * Returning the new display time is not a convenience: ageing a trip REWRITES its departure, so the
 * card stops showing the time the spec published and starts showing this one. Asserting on the
 * original string finds nothing, which is exactly how this suite failed the first time it ran.
 *
 * `created_at` moves with `depart_at`: D-47's trip_depart_not_before_created is a CHECK, so it
 * guards updates as well as inserts, and shifting only the departure would be rejected.
 */
export async function ageTripsInGroup(groupId: string, minutesAgo = 5): Promise<{ displayTime: string }> {
  const admin = adminClient();
  // One instant for both the write and the rendered string, so they cannot straddle a minute.
  const { displayTime } = wallClock(-minutesAgo);
  const departAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const { error } = await admin
    .from("trip")
    .update({ depart_at: departAt, created_at: departAt })
    .eq("group_id", groupId)
    .eq("status", "scheduled");
  if (error) throw new Error(`could not age trips: ${error.message}`);
  return { displayTime };
}

/** Run the scheduler once, the way pg_cron does (D-21). Returns the tick's own report. */
export async function runCronTick(baseURL: string) {
  const env = loadEnvLocal();
  const res = await fetch(`${baseURL}/api/cron/tick`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  });
  const body = (await res.json()) as { settled?: number; failures?: string[] };
  if (!res.ok) throw new Error(`cron tick failed: ${JSON.stringify(body)}`);
  if ((body.failures ?? []).length > 0) throw new Error(`cron tick reported failures: ${body.failures!.join("; ")}`);
  return body;
}

/** The id of the group the driver is looking at, read from the database by name. */
export async function groupIdByName(name: string): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin.from("group").select("id").eq("name", name).maybeSingle();
  if (error || !data) throw new Error(`group ${name} not found: ${error?.message}`);
  return data.id as string;
}
