import { defineConfig } from "vitest/config";

// Separate config, same reasoning as vitest.rls.config.ts and vitest.admin.config.ts: this suite
// needs a live Supabase project AND a running `pnpm dev` server, since the routes it exercises use
// next/headers' cookies() and cannot be invoked as plain functions. Keeping it out of the default
// `pnpm test` include means `pnpm verify` still runs on a machine with neither.
//
// It is sequential on purpose. The tests share one group and one pair of accounts, and one of them
// deliberately mutates that group's kudos_weight mid-test — running files in parallel would let
// another test observe the injected weight.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
