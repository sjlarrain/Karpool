import { expect, type Page } from "@playwright/test";

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
  await page.waitForURL(/\/app/, { timeout: 10_000 });
}
