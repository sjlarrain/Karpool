# Carpool

A workplace commute carpool PWA with light gamification. Employees join a group tied to a fixed
route, publish and join trips, and earn points (Driven / Pooled / Kudos) on a leaderboard.

Core loop: driver publishes a trip → riders join → driver starts, then closes it → the system
awards points and prompts riders for kudos.

**Status:** Phase 0 (design tokens + component primitives) complete. No database, auth, or product
routes exist yet — see `docs/02_IMPLEMENTATION_PLAN.md` for the phase plan and
`docs/WORKLOG.md` for the current handoff.

## Stack

Next.js 15 (App Router, TypeScript) on Vercel, Supabase (Postgres + Auth), Web Push (VAPID),
Google Maps Directions API. Hand-written CSS with design tokens ported from the interaction
sketch — no Tailwind, no component library. See `docs/Carpool_App_Infrastructure_Plan_1.md` for
the full infrastructure plan.

## Prerequisites

- Node 20 LTS (22 preferred)
- pnpm 9+
- git 2.40+
- Supabase CLI (only needed once Phase 1 lands)

## Clone → running locally

```bash
git clone <repo-url>
cd Carpool
pnpm install
```

`pnpm` will refuse to finish installing until you approve native build scripts for a few
dependencies (`esbuild`, `sharp`, `supabase`, `unrs-resolver`). Review them, then run:

```bash
pnpm approve-builds
```

Then:

```bash
cp .env.example .env.local
```

Fill in `.env.local` from `01_PLATFORM_SETUP.md` — see [Environment variables](#environment-variables)
below. Values still unknown stay as `REPLACE_ME`.

```bash
pnpm dev
```

Open `http://localhost:3000`. The real product screens aren't built yet — `/styleguide` renders
the design-token primitives against the interaction sketch for comparison.

## Environment variables

Names and purposes are documented in `.env.example` at the repo root — copy it to `.env.local` and
fill in values from `01_PLATFORM_SETUP.md`. Never commit `.env.local` or print its values; it's
gitignored and unreadable by the coding agent by design.

## Scripts

| Script | Does |
|---|---|
| `pnpm dev` | Start the Next.js dev server |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | ESLint (`next lint`) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm format` | Prettier, writes in place |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:watch` | Unit tests, watch mode |
| `pnpm e2e` | Playwright E2E (arrives Phase 9) |
| `pnpm verify` | `typecheck && lint && test` — must pass before every commit |
| `pnpm db:types` | Regenerate `src/types/database.ts` from the local Supabase schema (arrives Phase 1) |
| `pnpm db:diff` | Diff local schema against migrations (arrives Phase 1) |

## Project structure

```
src/
  app/            Next.js App Router routes
    styleguide/   Dev-only route comparing tokens/primitives against the sketch
  domain/         Pure domain logic (points, trip state machine, seat math) — no I/O, unit-tested
  styles/
    tokens.css    Design tokens ported verbatim from the sketch — the only file allowed raw hex
    components.css Component primitives (.card, .btnP, .seg, .av, …) ported from the sketch
docs/             Planning docs, decisions register, worklog, API reference
supabase/         Migrations (arrives Phase 1)
```

## Migrations

Not yet applicable — the schema lands in Phase 1 (`docs/02_IMPLEMENTATION_PLAN.md` §4). Once it
does: `supabase start` locally, migrations live in `supabase/migrations/`, apply with
`supabase db push` (developer-run, not automated by the agent).

## Tests

```bash
pnpm test
```

Domain logic under `src/domain/` is unit-tested with Vitest (node environment,
`src/**/*.test.ts`). E2E (Playwright, the core publish → join → start → close → kudos loop) arrives
Phase 9.

## Testing push notifications on a real device

Not yet applicable — Web Push lands in Phase 5. Simulator success won't count as evidence; it'll
need verification on a real Android device and a home-screen-installed iOS 16.4+ device.

## Other docs

- `docs/Carpool App.dc.html` — the interaction sketch; the visual and behavioural spec
- `docs/Carpool_App_Infrastructure_Plan_1.md` — infrastructure plan (PWA + Vercel + Supabase + Web Push + Maps)
- `docs/02_IMPLEMENTATION_PLAN.md` — phases, goal function, data model, API surface
- `docs/API.md` — route reference, populated from Phase 3 onward
- `docs/DECISIONS.md` — open decisions register; unanswered = blocked, not guessed
- `docs/WORKLOG.md` — session handoff notes
