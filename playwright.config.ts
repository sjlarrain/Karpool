import { defineConfig, devices } from "@playwright/test";

// Core-loop E2E (G5). Runs against the dev server with a fixed pair of seeded test accounts
// (tests/e2e/global-setup.ts) rather than signing up fresh accounts per run — Supabase's built-in
// auth email rate limit made that impractical in practice (hit live during Phase 3/4/5 manual
// testing this same project).
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 90_000, // the core-loop test spans ~8 sequential steps across two real browser contexts
  fullyParallel: false,
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
