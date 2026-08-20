# Carpool

A workplace commute carpool PWA with light gamification. Employees join a group tied to a fixed
route, publish and join trips, and earn points (Driven / Pooled / Kudos) on a leaderboard.

Core loop: driver publishes a trip → riders join → driver starts, then closes it → the system
awards points and prompts riders for kudos.

**Status:** Phases 0, 1, 2, 3, 4, 5, 7, 8, and 9 of `docs/02_IMPLEMENTATION_PLAN.md` are complete —
auth, groups, the full trip lifecycle (publish/join/start/close), the append-only points ledger,
kudos, the leaderboard, Web Push, the admin console + audit log, and hardening (E2E, rate limits,
error boundaries, a11y) are all live against the real Supabase project and deployed to Vercel. Phase
6 (Google Maps) is deliberately deferred to the end of the build (see `docs/DECISIONS.md`) and is
the only phase left. See `docs/WORKLOG.md` for the current handoff and `docs/DECISIONS.md` for what's
still open.

## Stack

Next.js 15 (App Router, TypeScript) on Vercel, Supabase (Postgres + Auth + a Postgres function for
the transactional trip-join), Web Push (VAPID, via the `web-push` package), and deferred Vercel Cron.
Google Maps
Directions API lands last. Hand-written CSS with design tokens ported from the interaction sketch —
no Tailwind, no component library. See `docs/Carpool_App_Infrastructure_Plan_1.md` for the full
infrastructure plan.

## Prerequisites

- Node 20 LTS (22 preferred)
- pnpm 9+
- git 2.40+
- Supabase CLI (via `npx supabase`, no global install needed) — for applying migrations and
  regenerating types
- Docker Desktop, **optional** — only needed for `supabase start` (a fully local Postgres). Every
  migration in this repo has instead been applied directly to the shared dev Supabase project via
  `supabase db push --linked`, which doesn't need Docker.

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

Fill in `.env.local` — see [Environment variables](#environment-variables) below. Ask a teammate
for the shared dev Supabase project's values, or stand up your own project and run the migrations
(see [Migrations](#migrations)).

```bash
pnpm dev
```

Open `http://localhost:3000`. `/styleguide` (dev-only, 404s in production) renders the design-token
primitives against the interaction sketch for comparison.

## Environment variables

Names and purposes are documented in `.env.example` at the repo root — copy it to `.env.local` and
fill in values. Never commit `.env.local` or print its values; it's gitignored and unreadable by
the coding agent by design. Two groups worth knowing about:

- **App runtime** (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_*`,
  `CRON_SECRET`, …) — validated at boot by `src/env.ts`; the app won't start without these.
  `NEXT_PUBLIC_APP_URL` must be a full URL including `https://`/`http://` — a bare domain fails
  the build with `Invalid environment variables`.
- **Supabase CLI only** (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `DATABASE_URL`,
  `DIRECT_URL`) — never read by app code, only needed for ad hoc `supabase` CLI commands
  (`db push`, `gen types`).
- `ADMIN_BOOTSTRAP_EMAIL` — not read by the running app, only by `pnpm admin:bootstrap` (see
  [Scripts](#scripts)) to decide which account becomes the first `platform_admin`.

On Vercel, set the same App runtime variables in Project Settings → Environment Variables
(Production and Preview). Scheduled execution of `/api/cron/tick` is disabled until Phase 10,
after the project is moved to a paid Vercel plan. The endpoint remains available for manual
verification with `CRON_SECRET`.

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
| `pnpm test:rls` | RLS integration tests (needs a running Postgres — see [Tests](#tests)) |
| `pnpm test:admin` | Admin route integration tests — G9 (403 for non-admin) + G10 (audit row per mutation). Needs `pnpm dev` running (see [Tests](#tests)) |
| `pnpm e2e` | Playwright E2E — the core publish → join → start → close → kudos loop, driven through a real browser against two seeded accounts |
| `pnpm admin:bootstrap` | Promotes the account matching `ADMIN_BOOTSTRAP_EMAIL` to `platform_admin`. Idempotent — safe to re-run |
| `pnpm verify` | `typecheck && lint && test` — must pass before every commit |
| `pnpm db:types` | Regenerate `src/types/database.ts` from a **local** Supabase instance (needs Docker + `supabase start`) |
| `pnpm db:types:linked` | Regenerate `src/types/database.ts` from the **linked remote** project — what this repo actually uses, since Docker isn't assumed. Hand-patches literal-union types for CHECK-constrained columns afterward (see the note at the top of `database.ts`) |
| `pnpm db:diff` | Diff local schema against migrations |

## Project structure

```
src/
  app/
    api/          Route handlers — every route: authenticate → authorize → validate (zod) → act
      admin/       Platform-admin-only routes (users, groups, trips, ledger, audit-log, health)
    app/           The authenticated app shell (tabs: Carpools/Ranks/Group/You) and its screens
    admin/         The admin console UI (/admin) — gated to platform_admin, tabbed like the app shell
    styleguide/    Dev-only route comparing tokens/primitives against the sketch
  domain/          Pure domain logic (points, trip state machine, leaderboard, seat math) —
                   no I/O, unit-tested
  lib/
    supabase/      Server/admin Supabase client factories (D-04: writes always go through the
                    service-role client; RLS bounds the session client's reads as defense-in-depth)
    trips/         Shared trip-feed query, used by both the API route and the SSR page
    notify/        Shared "write a notification row + push it" helper
    push/          web-push wrapper; prunes dead subscriptions on 404/410
    api/adminAuth.ts  authenticateAdmin() — the authenticate+authorize step shared by every /api/admin/* route
    audit.ts       writeAuditLog() — appends to the append-only audit_log table
    rateLimit.ts   Postgres-backed rate limiter (serverless has no shared memory to count in)
  styles/
    tokens.css     Design tokens ported verbatim from the sketch — the only file allowed raw hex
    components.css Component primitives (.card, .btnP, .seg, .av, …) ported from the sketch
  types/database.ts  Generated from the live schema (`pnpm db:types:linked`), then hand-patched
scripts/
  bootstrap-admin.ts  Promotes ADMIN_BOOTSTRAP_EMAIL to platform_admin — see `pnpm admin:bootstrap`
supabase/migrations/ Schema migrations, applied in order
tests/
  e2e/             Playwright core-loop test + seeded-account setup/cleanup
  rls/             Cross-group RLS isolation test (needs a running Postgres)
  admin/           Admin route G9/G10 integration test (needs a running `pnpm dev` server)
docs/              Planning docs, decisions register, worklog, API reference
public/            manifest.webmanifest, sw.js, icons — the PWA/push surface
```

## Migrations

Migrations live in `supabase/migrations/`, applied in order. This repo's dev project has **no
Docker available**, so every migration so far has been applied directly to the linked remote
project rather than via a local `supabase start`:

```bash
npx supabase link --project-ref <your-project-ref> --password "$SUPABASE_DB_PASSWORD"
npx supabase db push
```

(`SUPABASE_ACCESS_TOKEN` must be set in your environment for `link`/`push` to authenticate — see
[Environment variables](#environment-variables).) `db push --dry-run` shows what would apply
without touching anything. If you do have Docker, `supabase start` + `supabase db push --local` (or
just editing and re-running migrations locally) works the normal way too.

After any schema change, regenerate types:

```bash
pnpm db:types:linked
```

and reapply the literal-union patches documented in the comment at the top of
`src/types/database.ts` (the generator returns CHECK-constrained columns like `trip.status` as
plain `string`, not a literal union).

## Tests

```bash
pnpm test          # unit tests — pure domain logic, no I/O, run anywhere
pnpm test:rls       # RLS cross-group isolation — needs a real Postgres connection (Docker locally,
                    # or point it at a disposable project; never run against the shared dev project)
pnpm test:admin     # G9 (403 for non-admin) + G10 (audit row per mutation) — needs `pnpm dev`
                    # already running in another terminal; creates and cleans up its own throwaway
                    # admin/member test accounts against the real dev Supabase project
pnpm e2e            # Playwright — starts the dev server itself, seeds two fixed accounts
                    # (e2e-driver@carpool.test / e2e-rider@carpool.test) idempotently, and cleans up
                    # each account's trip/group data before every run
```

`pnpm e2e` needs `.env.local` filled in (it talks to the real dev Supabase project) and Playwright's
Chromium downloaded — `npx playwright install chromium` if `pnpm e2e` reports it's missing.

## Deploying to Vercel

1. Import the GitHub repo as a Vercel project (Next.js is auto-detected).
2. Set every "App runtime" variable from [Environment variables](#environment-variables) in
   Project Settings → Environment Variables (Production and Preview). `NEXT_PUBLIC_APP_URL` must
   be the deployed domain **with its `https://` protocol** — a bare domain fails the build.
3. Deploy. If this is the first deploy, `NEXT_PUBLIC_APP_URL` won't be known yet — deploy once,
   then set it to the assigned domain and redeploy.
4. In the Supabase dashboard → Authentication → URL Configuration, add the deployed domain to both
   **Site URL** and **Redirect URLs**, or sign-in redirects break.
5. After completing Phase 10, confirm `GET https://<domain>/api/cron/tick` with
  `Authorization: Bearer <CRON_SECRET>` returns 200 and verify both cron jobs.
6. Run `pnpm admin:bootstrap` locally (it talks to Supabase directly, not through Vercel) once
   you've signed up on the deployed app with the email in `ADMIN_BOOTSTRAP_EMAIL`.

## Testing push notifications on a real device

Web Push (VAPID) is implemented and verified live (subscribe/unsubscribe routes, the server-side
send path, dead-subscription pruning, the cron reminder/auto-close logic) — but **actual delivery
to a device has not been verified**, since no physical device was available during development.
Before trusting push in production:

1. Set a real `VAPID_SUBJECT` (`mailto:` or `https:` — `web-push` rejects anything else).
2. Install the PWA on an Android device (Chrome) and, separately, an iOS 16.4+ device **added to
   the home screen** (Safari-tab-only sessions never receive push on iOS — no workaround, it's an
   Apple platform restriction; the app shows an in-app nudge for this).
3. Enable notifications from the You tab, trigger a trip start/close/kudos from another account,
   and confirm the OS-level notification actually appears. Simulator success is not evidence.

## Other docs

- `docs/Carpool App.dc.html` — the interaction sketch; the visual and behavioural spec
- `docs/Carpool_App_Infrastructure_Plan_1.md` — infrastructure plan (PWA + Vercel + Supabase + Web Push + Maps)
- `docs/02_IMPLEMENTATION_PLAN.md` — phases, goal function, data model, API surface
- `docs/API.md` — route reference, kept current with every route change
- `docs/DECISIONS.md` — open decisions register; unanswered = blocked, not guessed
- `docs/WORKLOG.md` — session handoff notes
