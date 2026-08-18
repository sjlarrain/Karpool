import { defineConfig } from "vitest/config";

// Separate config so the admin-route integration suite (G9/G10 — needs a live Supabase project AND
// a running `pnpm dev` server, since /api/admin/* routes use next/headers cookies() and can't be
// invoked as plain functions outside a real HTTP request) never becomes part of the default
// `pnpm test` include. Run explicitly via `pnpm test:admin` with the dev server already running.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/admin/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
