# Worklog

## Shipped (polish sweep — sketch vs deployed app; bell, invite link, You tab)
- **Context correction**: the app is live on Vercel and push works. Every earlier entry claiming no
  deployment exists / `VAPID_SUBJECT` is invalid / G6 unsatisfiable is superseded. The live DB now
  holds real user data (a real group alongside the seeded `e2e-*@carpool.test` accounts), so
  migrations and writes there are production actions — get authorization first.
- **Notification bell** (`77fa80b`) — existed as a backend with no front door. `notifyProfiles()`
  has written `notification` rows since Phase 5 (start/close/edit + cron reminder) and nothing ever
  read them. Added `GET /api/notifications`, `POST /api/notifications/read`, the sketch's bottom
  sheet with its per-type tints, and the header bell + unread dot. `relativeTime()` is pure and
  tested (the sketch's "now/2m/1h/1d" vocabulary, boundaries and future-clamp).
- **Migration 0005** — `0001_init.sql` gave `notification` a SELECT policy but never an UPDATE one,
  so mark-read silently updated zero rows under RLS (confirmed live: `{"updated":0}`). Written,
  applied to the live project with the developer's authorization, re-verified: `{"updated":1}`,
  unread 1 → 0.
- **Invite link** (`3922b5a`) — `/j/:code` had never been built, so every invite link the app has
  ever handed out 404'd. Route now joins-and-lands when signed in, and names the group + prefills
  the code when signed out. Share also uses `navigator.share` on mobile and builds the URL from the
  live origin rather than `NEXT_PUBLIC_APP_URL`.
- **You tab** (`e8ab088`) — was a placeholder line. Both missing pieces already had backends:
  `/api/me/points` (stat tiles) and `PATCH /api/memberships/:id` (pickup place, which no screen
  anywhere could set, so every membership had `pickup_place_id` null). Plus a leaderboard empty
  state for the state every new group starts in.
- Pushed to `origin/main` with authorization (`a7aea29..3922b5a`, later `e8ab088`), which also
  carried the previously-unpushed Phase 8 admin console.
- `docs/DECISIONS.md` and `docs/WORKLOG.md` are now tracked in git (`5b73dbb`) — they were
  gitignored, so the decision register and every handoff lived on one machine only.

## In Progress
- Nothing mid-flight.

## Next
- D-18 (kudos decline path) is the one thing blocking the kudos flow from matching the sketch.
- Sketch-vs-app sweep found no other drift: Carpools, Ranks, Trip detail, Group profile, Create/
  Close trip, Switch group, Create group, Leave confirm and the auth screens are all faithful ports.

## Blocked On
- **D-18** — kudos prompt has no "no thanks" path; a rider who doesn't want to give kudos can never
  clear it off a closed trip. Needs a product call on whether a decline is recorded or dismissed.
- **D-03** — Maps, deferred indefinitely on a business condition: not until the app shows real
  traction, because it is a paid API.
- **D-17** — the `comment` notification type now renders in the bell, but nothing can create one.
- Vercel Hobby caps cron at once a day, degrading the 15-min reminder and 6-hour auto-close.

## Gates Now Green
- G1 (`pnpm verify`): green — typecheck, lint, 80/80 tests (5 new for `relativeTime`).
- G7 (no hex outside tokens.css): held — the sketch's notification tints were added as tokens
  rather than inlined.
- G8 (API docs): `docs/API.md` documents both new notification routes in the same commit.

## Shipped (Phase 8 — admin console + audit log; D-07/D-14 resolved, only Phase 6/Maps left)
- D-07 (admin scope) marked Applied — the `platform_admin`/`group_admin` split it recommended was
  already in the schema since Phase 1; just confirmed with the developer while unblocking Phase 8.
- D-14 (PII/audit-log retention) resolved: keep every `audit_log` row indefinitely, no
  redaction/purge job. Developer's call — not a priority for a small internal tool with no
  compliance requirement; the admin capability itself mattered more than a retention policy.
- `scripts/bootstrap-admin.ts` (`pnpm admin:bootstrap`) — idempotent, promotes whichever account
  matches `ADMIN_BOOTSTRAP_EMAIL` to `platform_admin`. Run live against the real project for the
  developer's own account.
- `src/lib/api/adminAuth.ts` (`authenticateAdmin()`) + `src/lib/audit.ts` (`writeAuditLog()`) —
  the shared authenticate→authorize step and audit-row writer used by every `/api/admin/*` route.
- 11 admin API routes (`src/app/api/admin/**`): metrics, users list/detail, role change, groups,
  trips, force-close, ledger browse/adjust, audit-log browse, health. Every mutation and every
  user-detail open writes an `audit_log` row (G10); every route re-checks `platform_admin`
  server-side, never trusts the client (G9). `docs/API.md` has full per-route detail.
- Admin console UI (`src/app/admin/**`) — a tabbed desktop console (Overview/Users/Groups/Trips/
  Ledger/Audit log/Health), reachable at `/admin` or via a "You" tab link shown only to
  `platform_admin`s. No sketch/mock exists for this surface (D-07 predates one), so it's a wider
  table-first desktop layout rather than the app's 430px phone frame, still built entirely from the
  same design tokens.
- **Real bug caught in browser verification, not by any automated test**: every tab's
  loading/error guard was written as `const guard = <LoadingOrError .../>; if (guard) return
  guard;` — but a JSX element is always a truthy object, so that check *always* fired and nothing
  ever rendered past the loading state, in all 7 tab files. `pnpm typecheck`/`pnpm lint` were both
  clean the whole time; only actually clicking through the console in the browser surfaced it.
  Fixed by checking `loading || failed` as booleans directly instead of instantiating the component
  into a variable first.
- `tests/admin/admin.test.ts` (`pnpm test:admin`, G9/G10) — hits the real `/api/admin/*` routes
  over HTTP against a running `pnpm dev` server (can't call them as plain functions;
  `createSupabaseServerClient()` needs `next/headers` cookies() from a real request). 14 tests,
  all passing live: every admin route 403s a non-admin, and `view_user_detail`/
  `admin_adjust_ledger`/`force_close_trip` all produce a matching `audit_log` row.
- **Second real bug, caught by the first live test run leaving data behind**: the test's own
  `afterAll` deleted `audit_log` rows by `entity_id` but not by `actor_profile_id`, so the admin
  test user's own audit rows (as actor) blocked its `auth.users` cascade delete on cleanup —
  `deleteUser()`'s error return isn't thrown, so this failed silently and left an orphaned test
  account in the live project. Fixed by deleting both `actor_profile_id`- and `entity_id`-owned
  rows before deleting either user, and logging (not swallowing) any deletion error. Manually
  removed the orphaned account; re-ran the suite to confirm cleanup now leaves zero residue.
- Deploy-prep bonus (see "Vercel deploy prep" below): `vercel.json` cron `GET` fix and
  `NEXT_PUBLIC_APP_URL` validation both landed this session too, ahead of Phase 8 proper.

## Shipped (Vercel deploy prep)
- `vercel.json` already existed (from Phase 5) with the correct `*/5 * * * *` cron schedule for
  `/api/cron/tick` — confirmed it's still correct, added the `$schema` field for editor validation.
- Real bug caught while double-checking this: the route only exported a `POST` handler, but Vercel Cron
  always sends `GET`, so every real tick would have 405'd in production despite passing every local
  test (tests/curl calls all used POST). Fixed by exporting the same handler for both `GET` and
  `POST`. Verified live against the dev server: `GET` with the real `CRON_SECRET` → 200
  `{remindersSent, autoClosed}`; `GET` with no header → still 401.
- **Not done by the agent, per plan**: creating the Vercel project, connecting the GitHub repo,
  entering env var values, and pushing to `origin/main` — developer-only per `02_IMPLEMENTATION_PLAN.md`
  and CLAUDE.md rule 3 (no push without per-session authorization). Full step list given in chat.
- Flagged to developer, not decided silently: Vercel's **Hobby plan runs cron jobs at most once a
  day**, which would break the 15-minute departure-reminder window and the 6-hour auto-close safety
  net — needs a Pro plan (or acceptance of degraded cron) to work as designed in production.

## Shipped (Phase 9 — hardening, E2E, rate limits, a11y, docs; Phase 8 still blocked on D-14)
- `tests/e2e/core-loop.spec.ts` (G5) — full core loop through a real browser (not the API directly):
  sign in, create a group, publish a trip, a second seeded account joins, driver starts and closes
  it, rider gives kudos, leaderboard reflects it. Uses two fixed seeded accounts
  (`e2e-driver@carpool.test` / `e2e-rider@carpool.test`, idempotent) rather than signing up fresh
  ones per run — Supabase's signup email rate limit made that impractical. `global-setup.ts` cleans
  up the prior run's group/trip data before every run so element selectors stay reliable.
  **Confirmed passing 3 consecutive runs.**
- Debugging this test surfaced and fixed a real product bug, not just test bugs: closed trips
  vanished entirely from the Carpools feed the instant they closed (the feed only ever queried
  `scheduled`/`started` trips), which meant the "Rate your ride" kudos UI built in Phase 7 was
  completely unreachable — no card left to click into. Fixed by including trips closed within the
  last 24h in `loadGroupTrips`.
- Also fixed a real bug in the push code: `webpush.setVapidDetails()` ran at module import time, so
  any route that merely imported the push module (even ones that never end up sending anything, like
  `/api/cron/tick`'s own auth check) would crash before its own logic ran, if `VAPID_SUBJECT` was
  invalid. Now configured lazily on first actual send.
- `supabase/migrations/0004_rate_limit.sql` — `rate_limit_hit` table + `src/lib/rateLimit.ts`,
  Postgres-backed (not in-memory — serverless functions don't share memory across instances or
  survive cold starts, so an in-memory counter wouldn't actually limit anything in production).
  Wired into join (20/10min), trip create (10/hour), kudos (20/hour). **Verified live**: seeded 10
  `trip_create` hits for the test driver, an 11th create attempt correctly 429'd.
- Error-boundary + toast audit: added `src/app/error.tsx`, `global-error.tsx`, `not-found.tsx`.
  Found and fixed a systemic gap — nearly every client-side mutation (`AppShell`, `CreateTripOverlay`,
  `CloseTripOverlay`, `GroupScreen` x3, `AuthGate` x2, `LockedGate`) had a `try { fetch... } finally`
  with **no `catch`**, so a genuine network failure (not just a non-OK response) would silently
  become an unhandled promise rejection instead of surfacing to the user. All now catch and show a
  real message.
- A11y pass: `.iconbtn` 38→44px, `.tab`/`.segb` given `min-height: 44px` (the plan's ≥44px tap
  target bar) — verified live via computed styles. Added a global `:focus-visible` ring (doesn't
  show on mouse/touch clicks). `@media (prefers-reduced-motion: reduce)` shortens the slide/sheet/
  toast animations to near-zero. `aria-label` added to icon-only back/sign-out buttons. **Known
  trade-off, not fixed**: several smaller inline-styled controls (the seat-count stepper, the
  quick-join `+`) are still under 44px — they're pixel-matched to the sketch (G7), and resizing them
  would visibly diverge from the source-of-truth mock; left as a documented follow-up rather than
  silently deviating from the spec.
- README fully rewritten to current state (was still describing Phase 0). `.env.example` gained
  `SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_PASSWORD` (CLI-only, needed for `db push`/`db:types:linked`,
  previously undocumented even though the project now depends on them).
- Google Maps (Phase 6) — still not started, still deliberately last per the standing decision.
  Developer pushes to Vercel, not the agent (per the plan) — no deploy attempted.

## Shipped (Phase 7 — kudos + leaderboard; Phase 6/Maps still deliberately deferred to the end)
- `src/domain/leaderboard.ts` (pure, tested — 8 cases): `aggregateLedger` (raw ledger rows → per-
  profile driven/pooled/kudos/points — never recomputed from counts × current weights, the ledger's
  own `points` values are the source of truth per phase 4's principle), `rankLeaderboard`
  (sort + medals, stable on ties), `formatWeightsCaption`.
- `POST /api/trips/:id/kudos` — binary, one per confirmed rider per closed trip, optional comment;
  awards `group.kudos_weight` points to the driver (kudos points go to whoever *receives* kudos,
  matching the score formula being about points received, not given).
- `GET /api/groups/:id/leaderboard` (calendar-month window, D-12) and `GET /api/me/points`
  (lifetime, all-time — D-12's "ledger stays all-time" applies here). D-11 (per-group weights) was
  already implemented since Phase 4; D-12 applied this session as an agent judgment call matching
  the already-recorded recommendation.
- `RanksScreen.tsx` (gradient score header, driven/pooled/kudos tiles, medal rows, formula caption,
  "you" row highlighted) replaces the Ranks tab's `ComingSoon` stub. `TripDetailOverlay` gained a
  "Rate your ride" kudos prompt for confirmed riders on closed trips (shows "Kudos sent" once given,
  not a repeatable action).
- **Verified live end-to-end**: full publish → join → start → close (13 pts = 10 drive + 3 pool) →
  rider gives kudos (+2, driver total 15) → leaderboard correctly shows the driver ranked #1 with 🥇,
  `driven:1 pooled:1 kudos:1 points:15`, the rider at 0 (riding alone earns nothing — matches the
  documented design), and the exact weights formula caption; a second kudos attempt correctly 409s
  `already_given`; `GET /api/me/points` matches the leaderboard entry. All test data cleaned up.

## Shipped (Phase 5 — PWA shell, service worker, Web Push)
- `public/manifest.webmanifest`, `public/icons/icon.svg` (SVG, no PNG-generation tooling needed),
  `public/sw.js` (install/activate/push/notificationclick — no offline caching, not required by the
  plan's Phase 5 scope). Verified live: manifest fetches `200 application/manifest+json`, sw.js
  registers a real service worker at scope `/`.
- `src/lib/push/send.ts` — `sendPushToProfile()` wrapping `web-push`; dead subscriptions (404/410)
  are pruned, other failures increment `failure_count`. VAPID config is lazy (first actual send),
  not module-load-time — fixes a real bug caught live where a bad `VAPID_SUBJECT` crashed every
  route that merely imported the module, including ones whose auth check should've 401'd first.
- `POST /api/push/subscribe` / `unsubscribe`, `PushSubscribe.tsx` (client opt-in UI in the You tab),
  `IosInstallPrompt.tsx` (iOS Safari standalone-mode nudge — push literally cannot work on iOS
  without it, per the infra plan §4).
- Trip lifecycle now actually notifies: start → `start`-type to active riders; close → `rate`-type
  to confirmed riders (now also pushes, was notification-row-only in Phase 4); edit (depart/return
  time change) → new `change`-type. All via a shared `notifyProfiles()` helper.
- `supabase/migrations/0003_notification_reminder_type.sql` — added `"reminder"` to
  `notification.type`; the original five types were ported verbatim from the sketch's mock list,
  which never included a departure-reminder example.
- `POST /api/cron/tick` (`CRON_SECRET`-gated, `vercel.json` schedules it every 5 min): departure
  reminders (15-min window, deduped) + auto-close of trips left `started` 6+ hours (safety net, no
  point awarding — audit-logged as `cron_auto_close`). **Verified live end-to-end**: seeded a
  reminder-window trip and a stale started trip, ran the real endpoint — got back
  `{remindersSent:1, autoClosed:1}`, confirmed the actual `notification`/`trip`/`audit_log` rows,
  ran it again and confirmed dedup (`{remindersSent:0, autoClosed:0}`). Also verified auth gating
  (401 for missing/wrong secret) live.
- D-05 marked Applied — the recorded recommendation was the only reasonable direction; built as-is.

## Blocked on (Phase 5, real hardware needed)
- **G6 (verify push on a real device) is NOT satisfied.** This agent has no physical device, and the
  headless browser pane's `Notification.permission` is stuck at `"denied"` with no way to grant it —
  confirmed live, not assumed. Everything up to the actual OS-level notification (manifest, service
  worker, subscribe flow, server-side send call, cron logic) is verified live against the real
  database; only "does a real phone show the notification" is unverified. Needs a real-device pass
  before this phase can be called done in the G6 sense.
- **`VAPID_SUBJECT` in `.env.local` is not a valid `mailto:`/`https:` URL** — confirmed live via a
  thrown `web-push` error. No push will actually deliver until this is fixed to a real contact
  value. Doesn't block anything else (the crash-on-import bug this uncovered is now fixed).

## Shipped (Phase 4 — join/leave/close hardening + points ledger)
- `supabase/migrations/0002_join_trip.sql` — `join_trip()` Postgres function with `select ... for
  update` row locking, closing the concurrent-join race. Verified against the live database: two
  simultaneous join calls on a 1-seat trip produced exactly one winner. `POST /api/trips/:id/join`
  now calls it via `.rpc()` instead of a non-transactional count-then-insert.
- `src/domain/points.ts` (pure, tested — 11 cases): `computeCloseAwards` (drive + pool ledger
  entries, always to the driver — guests have no profile to hold their own points) and
  `computeLateLeavePenalty`/`isLateLeave` (per-group configurable window/penalty, D-10).
- `POST /api/trips/:id/leave` now checks the group's late-cancellation window and writes a
  `late_leave` ledger entry when applicable.
- `POST /api/trips/:id/close` now does the full flow: confirm/no-show registered riders, add guest
  riders, award drive+pool points to the driver, queue `rate` notifications for confirmed riders.
  `CloseTripOverlay.tsx` (rider checklist + guest-add) wired into `TripDetailOverlay`'s "End & close
  trip" button.
- Full lifecycle verified live end-to-end (real HTTP calls against the real project, throwaway data
  cleaned up after): signup → group → publish → join → start → close (confirmed rider + guest) →
  correct `points_ledger` rows (10 drive + 3+3 pool = 16, matches `pointsAwarded`) and a `rate`
  notification for the rider; separately, join→leave inside the window correctly returned
  `latePenalty: -5`.
- D-09 and D-10 marked Applied in `docs/DECISIONS.md` — both were already reflected in the Phase 1
  schema and are now exercised by real code, verified live.

## Shipped
- Phase 0 (tokens/primitives/`/styleguide`), Phase 1 (Supabase schema, RLS, auth), Phase 2 (groups,
  memberships, pickup places) — committed (`a8bac0d` schema, `53b6be5` auth+groups) and pushed to
  `origin/main`.
- Phase 3 (trip state machine + CRUD): `src/domain/tripMachine.ts` (pure, exhaustively tested — 29
  cases covering every status×event×actor combination plus T-2h timing edges), `tripDay.ts`
  (day-label/time formatting + grouping, tested), `toTripView.ts` (DB row → UI shape mapper, tested),
  `avatarColor.ts`/`initials.ts` (shared, extracted from `GroupScreen`'s inline `colorFor`). Full
  trip CRUD + lifecycle API (`GET/POST /api/trips`, `GET/PATCH /api/trips/:id`,
  `POST .../start|cancel|close|join|leave`) — `join`/`leave` are intentionally non-transactional in
  this phase; Phase 4 hardens them and adds the points ledger. Carpools tab UI (day-grouped cards,
  All/Mine filter, quick-join), Create Trip overlay, Trip Detail overlay (start/join/leave), and a
  new tabbed `AppShell` (Carpools/Ranks/Group/You + FAB) replacing the old group-only `/app` page.
  Also fixed a real onboarding dead-end found along the way: `LockedGate` had no path to create the
  very first group (only "enter a code") — added one, reusing the existing `CreateGroupSheet`.
- `docs/API.md` fully documents all auth/groups/trips routes; `docs/DECISIONS.md` D-08 and D-16
  marked resolved (D-08 was already implemented; D-16 confirmed by developer as fixed T-2h).
- `pnpm typecheck` / `pnpm lint` / `pnpm test` all green — 56 tests passing across 5 domain suites.

## In Progress
- Nothing mid-flight; Phase 3 is functionally complete pending this session's commit.

## Next
- Phase 4 (join/leave/close hardening + points ledger) — depends on D-09 (guest riders: already
  applied name-only in the schema) and D-10 (late-cancellation penalty: already applied as
  group-configurable default −5/60min in the schema) — both effectively pre-resolved by the Phase 1
  schema, so Phase 4 can start without new developer input.

## Also this session (infra)
- Discovered `0001_init.sql` had **never actually been applied** to the live Supabase project —
  Docker was unavailable all session, so `supabase start`/local db never worked, and there was no
  CLI auth to push to the remote either. Fixed: developer supplied `SUPABASE_ACCESS_TOKEN` +
  `SUPABASE_DB_PASSWORD` in `.env.local`, linked the CLI to the project (ref `yfuazmgofsynhqmenhhd`),
  and ran `supabase db push` for real — the full 11-table schema, RLS, and triggers are now live.
- Regenerated `src/types/database.ts` via `supabase gen types typescript --linked` (new
  `db:types:linked` script — `db:types` still targets `--local` for once Docker's available) and
  hand-patched the CHECK-constraint columns back to literal-union types (the generator can't infer
  those from a `CHECK`, only from a native Postgres enum).
- Ran `tests/rls/cross-group.test.ts` (G2) for the first time ever, against the live project —
  **passing**. Added proper cleanup (delete trip/group rows, delete both test users) so repeated
  runs don't leave orphaned data.
- Verified the Phase 3 Carpools tab live end-to-end: created a real test account via the admin API
  (bypasses the public signup rate limit), signed in, created a group and two trips via the actual
  API routes, confirmed the Carpools tab renders real data correctly (day grouping, role badge, seat
  math, avatar placeholders), confirmed `POST .../start` correctly rejects `too_early` for a
  trip >2h out and succeeds for one <2h out. All test data cleaned up afterward.

## Blocked On
- Phases 5+ decisions in `docs/DECISIONS.md` (D-03/05/07/11/12/14/17) — still open, will block their
  respective phases when reached.

## Gates Green
- G3 (trip state machine correctness): exhaustive transition matrix, 29/29 passing.
- G1 (`pnpm verify` on a clean checkout): green (typecheck, lint, 56/56 tests). Same pre-existing
  `next lint` deprecation warning as before, still non-blocking.
- G8 (API docs completeness) partial: every route through Phase 3 is documented in `docs/API.md`;
  full G8 claim waits until Phase 9.
