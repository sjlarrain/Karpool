import { defineConfig, devices } from "@playwright/test";

// Core-loop E2E (G5). Runs against the dev server with a fixed pair of seeded test accounts
// (tests/e2e/global-setup.ts) rather than signing up fresh accounts per run — Supabase's built-in
// auth email rate limit made that impractical in practice (hit live during Phase 3/4/5 manual
// testing this same project).
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // The two-person journeys (core loop, chat + no-show, edit + cancel) run 1-2 minutes each: ~8
  // sequential steps across two real browser contexts, plus a cold dev-server compile on first
  // visit. At 90s they sat at 80-90% of the budget and failed at whichever step the clock ran out
  // on, which read as flakiness. Each step still carries its own ~10s expectation, so a real hang is
  // caught there, not here.
  timeout: 180_000,
  fullyParallel: false,
  // Every spec drives the *same* two seeded accounts, so files must not run concurrently either —
  // `fullyParallel: false` only serialises within a file, and Playwright still fans files out across
  // workers. Two specs signing the rider into different groups at once made share-link.spec fail
  // only in a full-suite run (it passed alone), which is exactly how a red gate goes unnoticed.
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
