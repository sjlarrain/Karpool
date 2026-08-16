import { defineConfig } from "vitest/config";

// Separate config so the RLS integration suite (needs a live local Supabase / Docker) never
// becomes part of the default `pnpm test` include and can't accidentally break `pnpm verify` on a
// machine without Docker running. Run explicitly via `pnpm test:rls`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rls/**/*.test.ts"],
  },
});
