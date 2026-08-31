# Karpool

A workplace commute carpool PWA with light gamification. Employees join a group tied to a fixed
route, publish and join trips, and earn points (Driven / Pooled / Kudos) on a leaderboard.

Core loop: driver publishes a trip → riders join → driver starts, then closes it → the system
awards points and prompts riders for kudos.

On a **round trip** the close does one more thing (D-35): it materialises the return leg as a real
trip of its own, seating the riders who said at join time that they were coming back, and freeing
the seats of those who said they weren't. A round trip is therefore two rows with one departure
each, not one row with two — which is what lets `started_at`, `closed_at`, the T−2h start guard and
the 24h expiry each mean something unambiguous.

**Status:** Phases 0, 1, 2, 3, 4, 5, 7, 8, and 9 of `docs/02_IMPLEMENTATION_PLAN.md` are complete —
auth, groups, the full trip lifecycle (publish/join/start/close), the append-only points ledger,
kudos, the leaderboard, Web Push, the admin console + audit log, and hardening (E2E, rate limits,
error boundaries, a11y) are all live against the real Supabase project and deployed to Vercel. Phase
6 (Google Maps) is deliberately deferred to the end of the build (see `docs/DECISIONS.md`) and is
the only phase left. See `docs/WORKLOG.md` for the current handoff and `docs/DECISIONS.md` for what's
still open.

## Stack

Next.js 15 (App Router, TypeScript) on Vercel, Supabase (Postgres + Auth + Postgres functions for
the transactional trip-join and the return-leg generator), Web Push (VAPID, via the `web-push`
package), and Supabase `pg_cron` + `pg_net` for scheduling — **not** Vercel Cron, whose Hobby tier
caps at one run a day (D-21). Google Maps Directions API lands last. Hand-written CSS with design tokens ported from the interaction sketch —
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
| `pnpm test:integration` | Points-ledger route tests — exactly-once close (incl. concurrent), the D-42 drive/pool split, kudos award rollback. Needs `pnpm dev` running (see [Tests](#tests)) |
| `pnpm e2e` | Playwright E2E — the core publish → join → start → close → kudos loop, driven through a real browser against two seeded accounts |
| `pnpm admin:bootstrap` | Promotes the account matching `ADMIN_BOOTSTRAP_EMAIL` to `platform_admin`. Idempotent — safe to re-run |
| `pnpm verify` | `typecheck && lint && test` — must pass before every commit |
| `pnpm db:types` | Regenerate `src/types/database.ts` from a **local** Supabase instance (needs Docker + `supabase start`) |
| `pnpm db:types:linked` | Regenerate `src/types/database.ts` from the **linked remote** project — what this repo actually uses, since Docker isn't assumed. Hand-patches literal-union types for CHECK-constrained columns afterward (see the note at the top of `database.ts`) |
| `pnpm db:diff` | Diff local schema against migrations |
| `pnpm db:audit-ledger` | Read-only. Prints every `points_ledger` row grouped by trip, with that trip's riders and a per-profile total, so a duplicated close is visible at a glance. Writes nothing |
| `pnpm db:dedupe-ledger -- --yes` | Repairs award rows duplicated by a replayed close (see [D-41]). A close writes all its awards in one insert, so a shared `created_at` is the batch key: the earliest batch per trip is kept and later ones deleted. Dry-run without `--yes`; writes a JSON backup to `scripts/backups/` before deleting |
| `pnpm db:repool-ledger -- --yes` | One-shot D-42 backfill. Rewrites already-closed trips from driver-side pooling to rider-side: the driver's fill bonus folds into their `drive` row and each confirmed rider gains a `pool` row. Idempotent — skips trips already in the new shape. Dry-run without `--yes`; backs up to `scripts/backups/` first |
| `pnpm db:reset-data --yes` | **Destructive.** Empties the activity tables (`trip`, `trip_rider`, `kudos`, `points_ledger`, `notification`, `audit_log`, `feedback`, `rate_limit_hit`) in the linked project, leaving accounts, groups, memberships, pickup places and push subscriptions intact. Refuses to run without `--yes`; pass `--dry-run` to see the row counts first |

## Project structure

```
src/
  app/
    api/          Route handlers — every route: authenticate → authorize → validate (zod) → act
      admin/       Platform-admin-only routes (users, groups, trips, ledger, audit-log, health)
    app/           The authenticated app shell (tabs: Carpools/Ranks/Group/You) and its screens
    j/[code]/      Group invite link — joins the group, then lands on it
    t/[id]/        Ride share link — signed-in members only (D-20); opens the ride in the app
    admin/         The admin console UI (/admin) — gated to platform_admin, tabbed like the app shell
                   (Overview/Users/Groups/Trips/Ledger/Feedback/Audit log/Health)
    styleguide/    Dev-only route comparing tokens/primitives against the sketch
  domain/          Pure domain logic (points, trip state machine, leaderboard, seat math,
                   install-platform detection) — no I/O, unit-tested
  lib/
    share.ts       shareOrCopy() — the OS share sheet, falling back to the clipboard
    supabase/      Server/admin Supabase client factories (D-04: writes always go through the
                    service-role client; RLS bounds the session client's reads as defense-in-depth)
    trips/         Shared trip-feed query (used by both the API route and the SSR page) and the
                    stop resolver that validates a trip's stops belong to its own group (D-29)
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
  reset-data.ts       Clears trip and log data, keeps accounts and groups — see `pnpm db:reset-data`
  audit-ledger.ts     Read-only points_ledger dump grouped by trip — see `pnpm db:audit-ledger`
  dedupe-close-ledger.ts  Removes award rows duplicated by a replayed close — see `pnpm db:dedupe-ledger`
  repool-ledger.ts    Backfills closed trips into the D-42 rider-side pooling — see `pnpm db:repool-ledger`
supabase/migrations/ Schema migrations, applied in order
tests/
  e2e/             Playwright core-loop + ride-share-link tests, shared journey helpers,
                   seeded-account setup/cleanup
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

⚠️ **Read `src/types/database.ts`'s header before you commit the result.** The generator emits plain
`string` for every CHECK-constrained text column, which flattens the literal-union types the rest of
the app type-checks against — `trip.status`, `trip.direction`, `trip_rider.state`,
`membership.group_role`, `profile.platform_role`, `points_ledger.kind`, `notification.type` — and
`pnpm typecheck` fails immediately with a handful of "Type 'string' is not assignable to" errors.
Those unions are hand-maintained on purpose. Reapply them, or regenerate to a scratch file and copy
across only the parts that actually changed.

and reapply the literal-union patches documented in the comment at the top of
`src/types/database.ts` (the generator returns CHECK-constrained columns like `trip.status` as
plain `string`, not a literal union).

## Tests

**Know what the commit gate does and does not cover.** `pnpm verify` is `typecheck && lint && test`,
and `pnpm test` includes only `src/**/*.test.ts` — every one of which is a pure function in
`src/domain/` importing nothing but its own sibling module. So a green `verify` says nothing about
whether any API route, React component, SQL migration or RLS policy works. Every production defect
this project has had lived in exactly that gap. The four suites below that *do* execute real
behaviour each need a live Supabase project, and none of them runs as part of `verify` — run them
before shipping anything that touches a route or the schema.

```bash
pnpm test          # unit tests — pure domain logic, no I/O, run anywhere
pnpm test:rls       # RLS cross-group isolation — needs a real Postgres connection (Docker locally,
                    # or point it at a disposable project; never run against the shared dev project)
pnpm test:admin     # G9 (403 for non-admin) + G10 (audit row per mutation) — needs `pnpm dev`
                    # already running in another terminal; creates and cleans up its own throwaway
                    # admin/member test accounts against the real dev Supabase project
pnpm test:integration
                    # points_ledger correctness at the route level: a close is paid exactly once
                    # even with two requests in flight at the same instant, D-42's drive/pool split
                    # lands on the right people, and a kudos whose award cannot be written is
                    # refused rather than silently dropped. Same requirements as test:admin
                    # (`pnpm dev` running + a real Supabase project); throwaway accounts, cleaned up
pnpm e2e            # Playwright — starts the dev server itself, seeds two fixed accounts
                    # (e2e-driver@carpool.test / e2e-rider@carpool.test) idempotently, and cleans up
                    # each account's trip/group data before every run
```

`pnpm e2e` needs `.env.local` filled in (it talks to the real dev Supabase project) and Playwright's
Chromium downloaded — `npx playwright install chromium` if `pnpm e2e` reports it's missing. The specs
are the core loop (publish → join → start → close → kudos), the ride share link's access rules, and
the signup email-confirmation round trip (`signup-confirm.spec.ts`, which mints the confirmation
token with the admin API rather than waiting for a real email, then drives the real callback).

## Deploying to Vercel

1. Import the GitHub repo as a Vercel project (Next.js is auto-detected).
2. Set every "App runtime" variable from [Environment variables](#environment-variables) in
   Project Settings → Environment Variables (Production and Preview). `NEXT_PUBLIC_APP_URL` must
   be the deployed domain **with its `https://` protocol** — a bare domain fails the build.
3. Deploy. If this is the first deploy, `NEXT_PUBLIC_APP_URL` won't be known yet — deploy once,
   then set it to the assigned domain and redeploy.
4. In the Supabase dashboard → Authentication → URL Configuration, set both fields — they take
   **different** values, and sign-in redirects break if they don't:

   **Site URL** is the deployed **origin and nothing more** — `https://<domain>`, no path. It is the
   fallback Supabase redirects to when a link carries no allow-listed `redirect_to`, and it is what
   `{{ .SiteURL }}` expands to in the email templates below. Putting a path here (`.../auth/callback`)
   silently doubles it in those templates and produces dead confirmation links.

   **Redirect URLs** is the allow-list, and it must include the confirmation callback for every
   origin people sign up on, or the link in the signup email is rejected and the account can never
   be confirmed:
   - `https://<domain>/auth/callback`
   - `http://localhost:3000/auth/callback` (local development)
   - `https://*.vercel.app/auth/callback` (preview deployments, if you use them)

   Optionally, in Authentication → Email Templates → "Confirm signup", switch the link to the
   token-hash form so a confirmation opened on a **different device** than the one that signed up
   still works (the default `{{ .ConfirmationURL }}` uses PKCE, which is tied to the original
   browser). Both shapes are handled by `/auth/callback`:

   ```
   <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup">Confirm your account</a>
   ```

   That template can't carry the `?next=` the signup route sets, which is why the invite code is
   also stashed in `user_metadata.pending_group_code` — the callback falls back to it and still
   lands the visitor in the right group.
5. **Configure custom SMTP before anyone else signs up — without it, nobody but you can register.**
   Supabase's built-in sender is a demo facility, not an email service: it delivers **only to members
   of the Supabase project's own team**, and it allows **2 send attempts per hour across the whole
   project** (retries of a failed signup count). So the project owner signs up successfully, uses up
   the allowance, and every colleague gets `429 email_send_rate_limited` — "Too many confirmation
   emails have gone out in the last hour" — for an email that was never going to be delivered to
   them anyway. That limit cannot be raised while the built-in sender is in use.

   Any SMTP provider fixes both restrictions at once. **Which one to pick depends on whether you own
   a domain:**

   - **With a domain** — [Resend](https://resend.com) (3,000/month, 100/day free). Add the domain,
     paste the DNS records it gives you at your registrar, generate an SMTP key.
   - **Without a domain** — [Brevo](https://www.brevo.com/free-smtp-server/) (300/day, free forever).
     It is the one major provider that still offers *single-sender verification*: add your own
     address (a Gmail address is fine) under Senders, confirm the 6-digit code it emails you, and you
     can send to anyone. SendGrid's free plan ended in May 2025 and Mailjet expects a domain, so
     Brevo is effectively the only free no-domain option left. Its SMTP credentials are under
     **SMTP & API → SMTP**: host `smtp-relay.brevo.com`, port `587`, and the login + SMTP key shown
     on that page (the login is not always your account email — copy the one displayed).

   Then in Supabase → Authentication → Emails → **SMTP Settings**, enable custom SMTP and enter the
   host, port, username and password. **Sender email must be exactly the address you verified** with
   the provider, or it rejects the message; sender name is what employees see ("Karpool").

   Finally, raise Authentication → **Rate Limits** → *Rate limit for sending emails* — it stays at
   the built-in 2/hour until you change it, custom SMTP or not.

   Deliverability note if you went the no-domain route: `gmail.com` cannot be DKIM/DMARC-authenticated
   by a third-party sender, so confirmation emails are likelier to land in spam. Fine for a small
   internal tool; tell the first few people to check their spam folder. Moving to a real domain later
   is a provider-side change plus a new sender address in Supabase — no code change.

   SMTP credentials live in the Supabase dashboard only — never in this repo or in `.env.local`.
6. **Turn the scheduler on.** Migrations `0008`/`0009` create the `carpool-tick` pg_cron job, which
   posts to `/api/cron/tick` every 5 minutes — that is what sends T-15min departure reminders,
   auto-closes trips abandoned in `started`, and expires trips nobody ever started (D-23: 24h
   after departure they move to Past). Without it, those three things simply never happen. The job reads its target and its secret from Supabase
   Vault and does nothing until both exist, so add them once per project (Dashboard → Project
   Settings → Vault → *Add new secret*, or the SQL editor):

   ```sql
   select vault.create_secret('https://<domain>/api/cron/tick', 'carpool_tick_url');
   select vault.create_secret('<the same value as CRON_SECRET on Vercel>', 'carpool_cron_secret');
   ```

   Never commit those values. To confirm it works, sign in as a `platform_admin` and read
   `GET /api/admin/health` — `scheduler.lastStatus` should be `"succeeded"` and `scheduler.stale`
   should be `false`. `stale: true` means the ticks stopped; on the Supabase Free plan the usual
   cause is the project pausing after 7 days without activity.
7. Run `pnpm admin:bootstrap` locally (it talks to Supabase directly, not through Vercel) once
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
