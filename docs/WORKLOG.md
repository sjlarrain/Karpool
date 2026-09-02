# Worklog

## Shipped (2026-09-01, later — Alejandro's score fixed: the leaderboard is now trip-anchored, not timestamp-anchored)
- **Shipped:** the follow-up flagged in the previous entry. Developer: "so now it will work
  Alejandro's score? Please fix that so those cases don't fail." Yes — fixed.
- **Root cause confirmed, not just theorised.** A round trip's return leg is its own `trip` row
  with its own `closed_at` (D-35). `GET /api/groups/:id/leaderboard` windowed `points_ledger` by
  `created_at` and `trip_rider`'s pooled count by `trip.closed_at` — both raw timestamps — so a
  round trip whose legs close on either side of a calendar-month boundary had its two `drive` rows
  split across two different months' leaderboards, even though it is one continuous ride.
- **`src/domain/leaderboard.ts` gained `tripsInMonth()`** (pure, tested): decides month membership
  from each trip's *anchor* `depart_at` rather than its own — a back leg's anchor is its parent's
  `depart_at`, so both legs land in the same month no matter which one gets closed when, or how
  late. A one-way trip or an outbound leg is its own anchor.
- **The route now queries by trip id, not by timestamp range.** Every closed trip in the group is
  fetched (three columns: id, parent, depart), `tripsInMonth()` picks the set belonging to the
  current month, and that set drives both the `points_ledger` query (for `drive`/`kudos`/`no_show`
  rows, which all carry a `trip_id`) and the `pooled` seat count — so the two halves of a member's
  line can no longer disagree the way they could before. `admin_adjust` rows have no trip to anchor
  to and keep the original `created_at`-window rule, unchanged.
- **Verified against the live project before committing**, with a throwaway read-only script (not
  committed — deleted after use) that replicated the route's old and new query logic directly.
  Built the month boundary in UTC explicitly, since this dev machine's local zone is not UTC and a
  local-time boundary would not have reproduced the split that Vercel's UTC server actually hits:
  - **August** (the month the ride was actually taken): Alejandro went from **1 driven · 34 pts**
    (old — only the outbound counted; the back leg's `created_at` fell in September) to the correct
    **2 driven · 68 pts** (new — both legs, correctly attributed).
  - **September**: from a phantom **1 driven · 34 pts** (the back leg alone, stranded there by the
    old logic) to **0** (correct — the whole round trip belongs to August, not partially to two
    months).
- **`pnpm verify` green — 229/229 (4 new in `leaderboard.test.ts`)** — run and confirmed clean
  before this was committed, per the developer's "verify everything before pushing." **Pushed**
  (developer authorized): `27acd8d..9e30238` on `origin/main`, alongside the D-50 admin-start commit
  from earlier this session — both are now what Vercel builds from.

## In Progress
- Nothing mid-flight.

## Next
- The backlog already on record ([D-31]/[D-32]/[D-33], the open [D-36] key).

## Blocked On
- `pnpm db:unpool-ledger -- --yes` — unchanged, still the developer's to run.
- Live-DB test suites (`test:admin`, `test:integration`, `test:rls`, `e2e`) still need
  `SUPABASE_SERVICE_ROLE_KEY` in the shell to run directly — unchanged limitation, worked around
  this session with a throwaway script that loads `.env.local` itself (the same pattern
  `scripts/audit-ledger.ts` already uses) rather than the agent reading the file.

## Gates Green
- `pnpm verify` — typecheck, lint, **229/229 unit tests** (4 new in `leaderboard.test.ts`). Same
  pre-existing `next lint` deprecation warning, still non-blocking.
- Live-project read-only verification above, script deleted after use — nothing committed from it.

## Shipped (2026-09-01 — an admin can start a trip too, not just close it; Alejandro's trips audited)
- **Shipped:** [D-50]. The developer asked for "easier access to start and close trips as an
  administrator." Close already had a real, points-paying admin path ([D-35](i)'s restricted close,
  reachable via the admin console's force-close for a `started` trip) — but `start` was explicitly
  driver-only (`src/domain/tripMachine.ts`, narrowed 2026-08-30: "Start and cancel stay
  driver-only"). Asked directly whether to reverse that; developer said yes. `transition()`'s
  `start` branch now accepts `isGroupAdmin`, still gated by the same T-2h window (D-16) for
  everyone — cancel is untouched, nobody asked about it.
- **New `src/lib/api/startTrip.ts`**, mirroring `closeTrip.ts`'s shape: one write shared by the
  driver's own `POST /api/trips/:id/start` (now also checking the caller's `membership.group_role`,
  the same way `close` already does) and a new `POST /api/admin/trips/:id/force-start` in the
  platform admin console (`authenticateAdmin()`, `isGroupAdmin: true` regardless of the admin's own
  membership row — the same shortcut `force-close` already takes — audit-logged as
  `force_start_trip`). No reason required on force-start, unlike force-close: starting writes
  nothing to `points_ledger`, so there's no scoring judgment call to explain.
- **`AdminTripsTab`** gained a "Start" button next to "Force close" for `scheduled` trips.
- **Fixed in passing, found while touching this code:** the force-close confirmation copy read "it
  never touches the points ledger" unconditionally — true when D-35 was answer, wrong since D-35
  answer (A) made a `started` trip's force-close a real, paying restricted close. Now
  status-conditional: explains the payout for a `started` trip, the old points-free wording for a
  `scheduled` one that never ran.
- **`tripMachine.test.ts`**: new "admin start (D-50)" block (admin succeeds, still honours T-2h,
  a plain rider still can't, wrong status still rejected), and the old "opening close does not open
  start or cancel" test narrowed to just cancel, since start is now open.
- **`tests/admin/admin.test.ts`**: `force-start` added to the 403-for-non-admin route sweep, plus
  its own audit-log assertion, sequenced right before the existing force-close test so the shared
  test trip is genuinely `started` by the time that one runs (previously untested: force-close was
  only ever exercised against a `scheduled` trip in this suite, so its points-paying path had no
  live coverage here at all — it does now). **Not run this session** — needs
  `SUPABASE_SERVICE_ROLE_KEY`, which is only in `.env.local` (unreadable by design, CLAUDE.md §2.6).
- **Alejandro's trips, analysed (the developer's first ask).** `pnpm db:audit-ledger` (read-only)
  against the live project: he now correctly shows **2 driven · 68 pts**, all-time — the round trip
  closed 2026-08-31 (outbound, `0e938b27`) and its return leg (`45168fe3`, closed just after
  midnight UTC on 2026-09-01, "the trip through the back" the developer fixed yesterday). That
  matches the ledger exactly; `GET /api/me/points` (all-time) would show it correctly on his own You
  tab. **Flagged, not fixed:** `GET /api/groups/:id/leaderboard` (the Ranks tab) is deliberately
  **calendar-month-scoped** (D-12) — filtered on `points_ledger.created_at`. Because this round
  trip's two `drive` rows straddle the Aug 31 / Sep 1 boundary, viewing Ranks *today* would show
  Alejandro only **1** driven this month, not the 2 he actually has all-time — an artifact of a
  round trip spanning midnight that D-12 never considered. Left alone pending the developer's word:
  it's arguably working exactly as D-12 specified (a fresh monthly count), just surprising for a
  trip that crosses the boundary.

## In Progress
- Nothing mid-flight.

## Next
- Nothing new proposed beyond the backlog already on record ([D-31]/[D-32]/[D-33], the open [D-36]
  key). If the developer wants the month-boundary leaderboard quirk above addressed, that needs
  their answer first (window by `trip.closed_at` like the `pooled` count already does? accept it as
  D-12 working as designed?).

## Blocked On
- `pnpm db:unpool-ledger -- --yes` — unchanged, still the developer's to run (see 2026-08-31 entry
  below).
- `tests/admin/admin.test.ts`'s new force-start coverage needs a run against a live project with
  `SUPABASE_SERVICE_ROLE_KEY` set — not done this session.

## Gates Green
- `pnpm verify` — typecheck, lint, **225/225 unit tests** (5 new in `tripMachine.test.ts`). Same
  pre-existing `next lint` deprecation warning, still non-blocking.
- `pnpm test:admin` — not run (see Blocked On).

## Shipped (2026-08-31 — riders stop earning points, and keep their count)
- **Shipped:** [D-49], the last decision left open by the audit. The developer said "Remove rider
  points — we don't need points for riders." [D-49] had already logged that sentence as blocked
  because it reads two ways, and one of them silently reverses [D-42] from the same morning. Put
  back to them as the two leaderboards it produces rather than as the abstract question; they chose
  **(a)**: a rider still reads `1 pooled`, worth **0 points**. Both of the day's instructions hold
  at once — "the others must have one pooled" (a count) and "shouldn't have any point" (no score).
- **The register's own plan for (a) was wrong, and would have broken every close.** [D-49] said it
  was "a one-value change, `rider_pool_weight = 0`, no migration". `points_ledger` carries
  `check (points <> 0)` (`0001_init.sql:115`), so a zero-point `pool` row is rejected by the
  database and takes the whole close insert with it — the identical trap [D-43] documented behind
  `kudos_weight = 0`, one decision earlier. Caught before writing any of it.
- **So `pooled` moved off the ledger.** It is now a count of the rider's `confirmed` `trip_rider`
  seats on closed trips — windowed on `trip.closed_at` for the month view so both halves of a
  member's line cover the same period, all-time for `/api/me/points`. `aggregateLedger()` takes the
  count as a **required** argument (optional would let a caller fall back to `0 pooled` for
  everyone — the exact bug [D-42] existed to fix) and seeds profiles holding no ledger row at all,
  which is the case that matters: a member who has only ever ridden earns nothing, appears nowhere
  in the ledger, and must still show their rides. Side benefit — the display no longer depends on
  the ledger, so a duplicated award cannot read as "12 pooled" on screen the way [D-41] did.
- **Driver untouched.** Still `drive_weight` + the escalating seat bonus, guests included, so
  [D-19]'s economics keep their value exactly; a new test pins the 1/2/3-rider totals at 13/18/25 so
  a future change cannot move them by accident.
- Dropping the rider award made the close's profile-name lookup dead — it existed only to caption a
  rider's row "Pooled with <driver>" — so that query is gone from the close path too.
- Migration `0019` re-comments `rider_pool_weight` as deprecated rather than dropping it (dropping
  is irreversible without a restore; an int per group is cheap). Applied to the live project.
- `scripts/repool-ledger.ts` is superseded and now **pinned to its own historical shape** instead of
  calling the live `computeCloseAwards()`, which has moved on. A backfill must reproduce what it was
  written for, not follow today's rules.

- **Follow-up, same session:** `scripts/audit-ledger.ts` was left reporting `pooled` the old way and
  is fixed. It no longer reimplements the aggregation — it calls the app's own `aggregateLedger()`,
  so the diagnostic cannot drift from the thing it diagnoses again. The bug was worse than a wrong
  column: because the four riders hold **no ledger rows at all** after the cleanup, they vanished
  from the totals table entirely. They are back, reading `1 pooled · 0`.

## In Progress
- Nothing mid-flight. The code is complete and green; one data step is waiting on the developer.

## Next
- Nothing new proposed. The backlog after this is unchanged: [D-30] is next per the developer's
  ordering, and the [D-43] triage list (D-44..D-48) is still unbuilt.

## Blocked On
- **`pnpm db:unpool-ledger -- --yes`** — deletes the 5 existing rider `pool` rows (−15 pts, one
  per rider; no driver row touched). Dry run reviewed and correct; the delete itself was refused by
  the sandbox's permission classifier, so **the developer runs it — they said they would.** Until it
  runs, live riders read `1 pooled · 3` instead of `1 pooled · 0`: the code is right, the old rows
  are not.
- ~~`CLAUDE.md` §4's scoring line~~ — **done.** The developer instructed the edit directly rather
  than applying it by hand, so §4 now carries the driver/rider split, the `pooled` count and the
  no-show penalty, and the guest-rider row (which said guests "count toward pooled") is corrected
  too. Only §4 was touched; §2's hard rules are untouched.
- The [D-41] double-pay race is closed for `close`, but the rest of [D-43]'s triage (D-44..D-48) is
  still open and unbuilt.

## Gates Green
- `pnpm verify` — typecheck, lint, **221/221 unit tests**. Same pre-existing `next lint` deprecation
  warning, still non-blocking.
- `tests/integration/close-and-kudos.test.ts` updated: the end-to-end assertion now reads "the whole
  award lands on the driver and no rider row is written". That one assertion has now been wrong
  twice ([D-19] put the pool row on the driver, [D-42] on the rider), which is the argument for
  keeping it at the integration layer.

## Shipped (2026-08-31 — the full audit, and the two ways points went wrong)
- **Shipped:** [D-43]. The developer asked for a complete audit — link errors, whether the driver
  is paid and driven/pooled are classified right, decisions not built as designed, and "why do we
  have test if when I run the app mistakes arise". Findings recorded as [D-43] through [D-49]; the
  two that corrupt `points_ledger` were fixed this session, on the developer's instruction to take
  those first.
  **(1) The close double-pay race, reproduced rather than argued.** `transition()` is a read, so two
  closes in flight together both saw `started`, both were told the close was legal, and both wrote a
  full award set. Fired two simultaneous closes at the live project and got **two `drive` rows, one
  ride paid twice** (test data removed afterwards). This is the *concurrent* sibling of [D-41]; the
  [D-39] reordering closed the sequential retry and never this, which is why the worklog has carried
  it as "Next" for two entries. **The realistic trigger is not a driver double-tapping** — the UI
  disables its own button — it is that [D-35] mechanic (ii) has the **scheduler** close round
  trips at T−2h before `return_at` every five minutes, so a driver tapping Close in that window
  races a cron job. Fixed with a compare-and-swap claim (`... where id=? and status='started'`)
  taken **before** the guest rows and the ledger, and every failure between the claim and the ledger
  now *releases* it, so the close stays as retryable as it was before.
  **(2) Kudos points could vanish and never come back.** The award insert dropped its error. The
  `kudos` row is written first under `unique(trip_id, from_profile_id)`, so a failure left the rider
  with a `201`, the driver with nothing, and no route to recover: a second attempt answers
  `409 already_given` for ever. Now the kudos row is rolled back and the call answers
  `500 kudos_award_failed`. Reachable with no infrastructure fault at all — `points_ledger` has
  `check (points <> 0)`, so a group admin setting `kudos_weight = 0` to switch kudos scoring off was
  silently eating every rating.
- **[D-42] audited clean.** Against the live ledger: driver `1 driven · 0 pooled · 34`, the four
  riders `1 pooled · 3` each; the drive row carries the whole fill bonus, guests fill seats and earn
  nothing, no-shows are charged to the rider. Now asserted end-to-end rather than only in the pure
  function.
- **In progress:** nothing mid-flight.
- **Next:** [D-49] is blocking and is the developer's — "the rider shouldn't have any point" can
  mean `rider_pool_weight = 0` (rider still reads `1 pooled`, worth nothing) or no rider `pool` row
  at all (rider reads `0 pooled`, undoing this morning's [D-42]). Do not guess. Then [D-47] (already
  decided: reject `return_at <= depart_at` in zod **and** a DB CHECK), [D-44] (push deep link, one
  line), [D-45] (the "Couldn't load this trip" dead end), [D-46] (the invite link's swallowed
  insert), [D-48] (what the commit gate should cover).
- **Blocked on:** [D-49] only. **Two blockers recorded in [D-39] are stale and now cleared:** the
  `carpool-tick` Vault secrets (the scheduler reports `active: true`, `last_status: succeeded`,
  `last_run_at: 22:00`) and migration `0017` (applied — a `close_reminder` row exists). Still the
  developer's: a valid `VAPID_SUBJECT`, though `src/domain/vapidSubject.ts` now repairs a
  scheme-less value, so check `GET /api/admin/health` → `push.channel` before assuming it is broken.
- **Gates now green:** `pnpm verify` — typecheck, lint, **220/220 across 17 suites**; `pnpm e2e`
  **6/6** against the live database; new `pnpm test:integration` **4/4**. Both new tests were proved
  non-vacuous by reverting each fix and watching the matching one fail — `[200, 200]` for the
  race, `201` instead of `500` for the kudos.

## Also this session (the answer to "why do we have tests")
- **The commit gate cannot see the layer the bugs live in, and that is the whole answer.**
  `pnpm verify` is `typecheck && lint && test`, and `vitest.config.ts` includes only
  `src/**/*.test.ts`. All 17 suites / 220 tests live in `src/domain/`, and — checked import by
  import — every one imports nothing but its own sibling module and `vitest`. **Zero touch an API
  route, a component, the database, RLS or a migration.** The suites that do execute real behaviour
  each sit behind their own config and none is in `verify`. So the tests are not lying; they test
  220 things that were never broken, while every production defect this project has had (the VAPID
  throw, the close double-pay, the `.maybeSingle()` dedupe inversion, the swallowed rider lookup)
  lived in the gap. Recorded as [D-48], with the question of how far to take it left open.
- New `tests/integration/` + `vitest.integration.config.ts` + `pnpm test:integration` — HTTP-level
  tests against a running dev server, the same shape as `tests/admin`. The concurrency test
  **cannot** be written any other way: the bug only appears with two requests in flight, so no unit
  test and no single-threaded Playwright journey can reach it. README now states plainly what a
  green `verify` does and does not mean.
- **Counted while looking:** 60 call sites across `src/app/api` and `src/lib` destructure only
  `data` from a Supabase query and drop the error. Most are harmless `maybeSingle()` lookups where
  absent and broken both mean 404; the ones that are not turn a failure into "there is nothing
  here" — the leaderboard renders empty, the cron sweeps nothing, `cancel` notifies no riders,
  `push/send` finds no devices. Not swept this session; scoped in [D-48].

## Also this session (link paths, checked in a real browser)
- **The share and invite dead-ends are all correct** — verified live: `/t/<bad-uuid>`,
  `/t/<a trip in another group>` and `/j/ZZZZZZ` each render a friendly, accurate page. The
  `href="#"` links in `AuthGate`/`LockedGate` all `preventDefault()`. So the link *pages* are fine;
  the three faults are elsewhere and are [D-44], [D-45] and [D-46].
- The one reproduced in the browser is [D-45]: `/app?trip=<a trip you cannot see>` renders
  **"Couldn't load this trip."** over a Retry button that can never succeed, because
  `TripDetailOverlay.load()` collapses 401/403/404/500 into one boolean. `/t/:id` already handles
  the identical case properly, and its wording is what to reuse.

## Shipped (2026-08-31 — "pooled" belongs to the rider, not the driver)
- **Shipped:** [D-42]. The developer rejected the [D-41] repair — "Alejandro drove once and he
  wasn't pooled that time. The others must have one pooled" — and they were right about something
  bigger than the duplicate rows: [D-19] wrote the `pool` row onto the **driver**, so the word meant
  its own opposite and riders could never score at all. Reshaped so the driver takes one `drive` row
  carrying `drive_weight` + the whole fill bonus, and each confirmed registered rider takes one
  `pool` row worth the new per-group `rider_pool_weight`. Developer picked **3** for the rider and
  **keep the fill bonus, folded into `drove`** — so no driver's total moves, only the label. New
  `computeCloseAwards` returns `{ driver, riders }` instead of a flat array; migration `0018` adds
  the column; `scripts/repool-ledger.ts` backfilled the three closed trips (bonus taken from the rows
  actually written, not recomputed, so totals are preserved). Live leaderboard now reads Alejandro
  `1 driven · 0 pooled · 34` and Felipe/Manolo/Agustin/sjlarrain `1 pooled · 3` each.
- **In progress:** nothing mid-flight.
- **Next:** the [D-41] double-pay race — `closeTrip` still reads trip status then writes without a
  conditional update, so two concurrent closes both pass `transition()` and both pay. Then D-35, D-30.
- **Blocked on:** nothing here. **Migration `0018` was applied by the developer the same session**
  (`supabase db push --linked` had been refused by this environment's permission layer) — confirmed
  live: every group carries `rider_pool_weight = 3`, and the backfill re-run reports "nothing to
  migrate", so it is idempotent as intended. `pnpm db:types:linked` was re-run and the CHECK-column
  literal unions reapplied; that regen also closed three drifts the hand-maintained copy had
  accumulated — `trip_rider.kudos_declined_at`/`.penalty_waived_at` were missing, the
  `carpool_cron_status`/`carpool_cron_tick` functions were missing, and a stale `seat_member` entry
  described a function that no longer exists in the database (referenced nowhere in `src/` or any
  migration). Note `0017` turned out to be applied already — the [D-39] claim that it was pending is
  stale. **The new code still needs deploying.** Still the developer's: `carpool-tick` Vault
  secrets, `VAPID_SUBJECT`.
- **Gates now green:** `pnpm verify` — typecheck, lint, **220/220 tests across 17 suites**.

## Shipped (2026-08-31 — the duplicated close awards, repaired on the live leaderboard)
- **Shipped:** the data cleanup [D-39] said would be needed. Developer sent a Ranks screenshot —
  "He pooled 4 people not 12" — and they were right. `scripts/audit-ledger.ts` (read-only) found
  **one** trip (`0e938b27`, 4 riders) whose close awards were written **three times**: `16:20:51`,
  `16:20:56`, `17:03:16`, 1 `drive` + 4 `pool` per run. Textbook replayable close — ledger written,
  push threw on the invalid `VAPID_SUBJECT`, status never flipped, driver tapped Close again.
  `scripts/dedupe-close-ledger.ts` (dry-run default, JSON backup before delete, keeps the earliest
  batch per trip using the shared `created_at` as the batch key) removed **10 rows / −68 pts**.
  Alejandro Rivera: **3 driven · 12 pooled · 102** → **1 driven · 4 pooled · 34**. Re-audited clean;
  no other trip affected. Deleted rather than compensated with `admin_adjust` on purpose — `driven`
  and `pooled` are *row counts*, so an adjustment fixes the score and leaves the counts lying.
  Recorded as **[D-41]**.
- **In progress:** nothing mid-flight.
- **Next:** close the remaining double-pay *race* — the [D-39] reordering kills the sequential
  retry, but `closeTrip` still reads the trip status and then writes without a conditional update,
  so two concurrent closes both pass `transition()` and both pay. A gated
  `UPDATE trip SET status='closed' WHERE id=? AND status='started'` before the ledger write, or a
  unique index on the close-award rows, closes it. Then back to the backlog: D-35 return leg, D-30.
- **Blocked on:** [D-41]'s open question — is `pooled` a driver-only stat? Riders show `0 pooled`
  even when they rode, which is [D-19] working as designed; the developer's "the other have been
  pooled once" was read as evidence for the count of four, not as a request to credit riders.
  Changing it is a scoring-model decision. Also still the developer's: the `carpool-tick` Vault
  secrets, a valid `VAPID_SUBJECT`, migration `0017`.
- **Gates now green:** `pnpm verify` — typecheck, lint, **215/215 tests across 17 suites**.

## Shipped (2026-08-31 — branch `dev`: notifications that arrive, invites that survive, and a nudge to close)
- **The ask (developer):** three patches on a new `dev` branch — "fix the notification system... so
  the users receive them when the trip is starting"; "the sharing link is not working so users can
  subscribe to the group"; "send a notification to the rider that his trip hasn't been closed yet".
  Recorded as **[D-39]**.
- **Notifications — four distinct faults, all in code, none of which needed the scheduler to be
  running to bite.** (1) **A bad `VAPID_SUBJECT` took down the whole notify path.**
  `ensureVapidConfigured()` was made lazy so it could not crash routes at import time, but the throw
  was only *moved*: it escaped `sendPushToProfile`, escaped the `Promise.all` in `notifyProfiles`,
  and reached the caller — so `POST /api/trips/:id/start` answered **500 for a trip that had already
  started**, and only once somebody actually had a subscription on file, which is why it would have
  looked intermittent. The Notes at the foot of `DECISIONS.md` have recorded since 2026-08-16 that
  this project's `VAPID_SUBJECT` is not a valid `mailto:`/`https:` value, so this is the fault that
  best matches "we don't get notifications when the trip starts". (2) **The departure-reminder
  dedupe was inverted by a `.maybeSingle()`** — `notifyProfiles` writes one row *per recipient*, so
  any trip with a rider aboard matched more than one row, `.maybeSingle()` answers that with an
  error, only `data` was destructured, and the reminder read as never sent: every phone re-pushed on
  each of the three ticks the window spans. The same swallowed-error shape as the two bugs in
  [D-38]. (3) **A missed tick dropped a reminder permanently** — the window ran from `now` forward,
  so a departure that slipped past between ticks was never eligible again. (4) **`PushSubscribe`
  never re-registered.** Delivery needs the endpoint in *two* places and only the browser's half is
  durable; the server's row is deleted on any 404/410 (a transient push-service outage is
  indistinguishable from an uninstall) and vanishes on any environment rebuild. The component asked
  the browser "are you subscribed?", got yes, and rendered nothing — removing the only way left to
  re-register, so the user believed notifications were on while the server had no address. It now
  re-sends on every visit (the upsert is keyed on endpoint, so it is free) and replaces a
  subscription minted under a rotated-away VAPID key, which fails 403 and is never pruned.
- **The sharing link.** `/j/:code` itself was correct — verified in a browser. The hole is the way
  back from the signup email: `?next=/j/CODE` **and** `user_metadata.pending_group_code` are both
  read *only* by `GET /auth/callback`, so both are lost together whenever the confirmation link does
  not land there — which is precisely what a Supabase project whose Site URL / redirect allow-list
  omits the deployed origin causes. New `src/lib/api/redeemPendingInvite.ts` redeems the stored code
  from `/` and `/app` too, wherever an authenticated visitor turns out to have no membership.
- **The unclosed-trip nudge** is a fifth scheduler job: 90 minutes in `started` sends a new
  `close_reminder` (migration `0017`) to the **driver** — the only person who can close a trip.
  Built for the driver although the ask said "rider"; flagged in [D-39] as the one thing worth
  confirming, and a one-line change if riders were meant.
- **Made visible rather than merely fixed**, since both blockers below are silent by nature:
  `notifyProfiles` returns its insert error instead of discarding it, `POST /api/trips/:id/start`
  returns `notifiedRiders` + `pushDelivery`, the tick returns `reminderFailures` /
  `closeReminderFailures`, and `GET /api/admin/health` gains `push.channel` beside the existing
  `scheduler.stale`. D-21's lesson applied to push: "nobody got a notification" and "the VAPID
  subject is not a mailto: URL" look identical from outside.

## Also this session (a production report that confirmed the diagnosis, and raised it)
- The developer sent a screenshot mid-session: **Close trip on `karpool-nu.vercel.app` answering
  "Couldn't reach the server"**, four riders confirmed. It is the VAPID throw, reached through the
  close route — and it is **not cosmetic**. `closeTrip` orders its writes so that everything before
  the `points_ledger` insert is idempotent and a failure there is safe to retry; but both
  `notifyProfiles` calls sat **between that ledger insert and the status flip**. The throw landed in
  the one non-idempotent window: past the ledger (driver paid), before the status update (trip stays
  `started`, so the state machine allows another close). **Every retry paid the driver again**, and
  the riders never got their kudos prompt. The client hid it — an unhandled fault returns HTML, so
  `res.json()` threw and the catch blamed the *connection* for a clean 500.
- Fixed in two commits: the status flip now follows the ledger immediately and notifications come
  last (a missed kudos prompt is recoverable; a duplicated payment is not), and `CloseTripOverlay`
  parses defensively and says "the trip may already have closed" instead of "check your connection".
- **Needs a data audit, not code:** trips closed in production since push subscriptions first
  existed may carry **duplicate `points_ledger` award rows** and may still be `started`.

- **Swept the same fault out of every other handler** (`src/lib/http/readJsonBody.ts`, 21 call sites
  across 11 components). Two things fell out of it: the notification poll had **no `res.ok` check at
  all**, so an error page parsed into `undefined` and blanked a good feed; and four handlers read
  fields off a successful reply (`group.id`, `needsEmailConfirmation`, `changed`/`notifiedRiders`,
  `pointsAwarded`) that would have dereferenced null. The three `.then(res.ok ? res.json() :
  reject)` loaders never had the defect and were left alone.

## Also 2026-08-31 (post-deploy: the scheduler lives, and the last fault named itself)
- **`main` deployed (`dd319ee`). `GET /api/admin/health` reports the scheduler `scheduled: true,
  active: true, lastStatus: "succeeded", stale: false` — [D-21] is closed after weeks dead.** That
  `succeeded` is also the `send.ts` fix proving itself in production: one push subscription is on
  file and the VAPID config is still broken, which on the old code would have thrown and aborted
  the tick.
- **The remaining fault named itself through the new field:** `push.channel.configured: false`,
  `error: "Vapid subject is not a valid URL. karpool-nu.vercel.app/contact"` — no scheme, so
  `new URL()` has nothing to parse. Recognisably what was meant, unusable only for a missing
  prefix, and the *second* time this variable has taken push down (flagged 2026-08-16, still broken
  today). `src/domain/vapidSubject.ts` now completes a scheme-less subject — `mailto:` for a bare
  address, `https:` for a bare host — and **only** that: never rewriting a scheme that is already
  present (an `http:` subject is passed through to be reported, since choosing https for someone is
  a judgement about their infrastructure, not a missing prefix). Every repair is announced via
  `push.channel.normalizedFrom`, because config that silently fixes itself is config nobody
  corrects at the source.
- `failingSubscriptions: 0` alongside a dead channel is also correct by design: the config-error
  path returns before the per-subscription loop, so a broken channel cannot smear `failure_count`
  across healthy subscriptions.

## Also 2026-08-31 (the sharing-link report, finally diagnosed)
- The developer confirmed **Confirm email is OFF**, which retires the theory the invite fix was
  built on: with confirmation off `signUp` returns a session immediately, so no real visitor ever
  reaches `/auth/callback` and `pending_group_code` is never on their path. `redeemPendingInvite`
  is still correct defence-in-depth, but **it was not the reported bug.**
- **New `tests/e2e/invite-link.spec.ts`, green against the live database**, drives the path nothing
  covered: signed-out visitor opens `/j/CODE`, signs up **on the invite page**, and is carried into
  the group — plus an existing account signing in there, and an unusable code. `share-link.spec.ts`
  covers the *ride* link and joins by typing the code; `signup-confirm.spec.ts` covers a route that
  only runs when confirmation is on. So the one live onboarding path was the one untested path, and
  it **works**.
- **The real fault is [D-40]:** the link people naturally share is the **ride** link `/t/:id`, and
  [D-20] deliberately makes it a dead end for non-members ("Ask whoever shared it for the group's
  invite link"). Correct, and indistinguishable from a broken link to whoever sent it. Recommended
  fix is to let `rideShareMessage()` carry the invite in the sharer's own text — which leaks nothing
  they don't already hold — but it is a product judgement with three open questions, so nothing was
  built.

## In Progress
- Nothing mid-flight. Ten commits on `dev`, not merged and not pushed.

## Next
- **The developer completed every dashboard-side action on 2026-08-31** — `VAPID_SUBJECT`,
  `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, the Supabase Site URL and redirect allow-list, and the
  [D-21] Vault secrets. **The scheduler therefore has a caller for the first time.** Migration
  `0017` is applied and **verified by this agent** against the live project (`migration list
  --linked`: `0017 | 0017`) — the `0016` lesson observed rather than repeated.
- `dev` is **merged into `main`** (`2e121cc`, `--no-ff`). `main` is **12 commits ahead of
  `origin/main` and not pushed** — production is still on `915e45d`, so none of the eleven fixes
  are live yet and the now-awake scheduler is driving the *old* tick. Pushing is the next action
  and needs the developer's word (CLAUDE.md §2.3).
- Then: `GET /api/admin/health` (`push.channel.configured: true`, `scheduler.stale: false`), and
  the duplicate-`points_ledger` audit, which is only meaningful once the fixes are deployed.
- **Audit `points_ledger` for duplicate award rows per `trip_id`**, and re-close any trip left
  `started` with points already written (see above).
- Answer [D-39](3): driver or riders for the unclosed-trip nudge.

## Blocked On
- **The push to `origin/main`**, which is what actually deploys any of this.
- **Live verification of the three patches.** `.env.local` is unreadable by design (CLAUDE.md §2.6)
  and this session's attempt to load it for a database probe was correctly refused, as was
  `supabase db push` — so the *code* was never exercised against the real project, unlike [D-38].
  What was verified live: migration `0017` (read-only CLI), and the new `readJsonBody` behaviour in
  a real browser against the real API — a bad password shows the route's own message, an injected
  HTML 500 shows the server-fault message rather than the connection one, and a genuine fetch
  rejection still shows the connection one. The e2e suite needs the live database and has not run.
- **The sharing-link diagnosis is the weakest of the three** and remains unconfirmed: whether
  Confirm email is on or off decides whether the signup-email round trip — the path
  `redeemPendingInvite` protects — is even on a user's route. Asked twice, still unanswered.
- Unchanged: [D-21] Vault secrets, custom SMTP, the Supabase URL config.

## Gates Green
- G1 (`pnpm verify`): typecheck, lint and **205/205** tests green (10 new in `tripReminders.test.ts`).
  Same pre-existing `next lint` custom-font warning, still non-blocking.
- G6 (push on a real device) still **not** claimable, and this session does not change that — the
  four faults above are removed, but only a real phone proves delivery.

## Shipped (2026-08-30 — a driver can cancel or edit a trip, and riders leave a changed one for free)
- **The ask (developer):** "add the possibility to cancel or edit a trip. Riders will be notified and
  they can jump off the trip without cost if that happens." Both API routes already existed and
  **neither was reachable** — `PATCH /api/trips/:id` and `POST /api/trips/:id/cancel` had no button
  anywhere in the app, cancel told the riders nothing at all, and leaving a trip that had moved under
  you still cost the D-10 late-cancellation −5.
- **Edit** — `src/app/app/EditTripOverlay.tsx`, on the driver's own scheduled trip: day, departure,
  return, seats, stops. `direction` is deliberately not editable (that is a different ride, not an
  edit of this one). The GET detail route now returns an `editable` block so the form opens filled in
  without a second round trip, mirroring how `addableMembers` is served. Incidentally delivers
  [D-35] answer (d) — the driver moving a generated return leg's departure.
- **Cancel** — a confirmation sheet with an optional reason that now reaches the riders verbatim
  (`notification.type: "change"`, title "Trip cancelled"). The reserved string `not_started` is
  refused: it is D-23's expiry sentinel, and a driver typing it would dress their own cancellation up
  as a trip nobody started.
- **The free drop-out** — `trip_rider.penalty_waived_at` (migration `0016`), stamped on every seat
  already aboard when a **material** field moves, honoured by `leave` as a third exception beside
  D-24's driver-added seats. Material is judged from the rider's chair: departure, return, either
  stop. Capacity is not — a seat added or taken back changes nothing for the people already in the
  car. The waiver is written **before** the notification, so a rider acting on the push the instant
  it lands finds the free drop-out already in force rather than racing it.
- **Two bugs fixed on the way**, both made reachable by this feature rather than created by it:
  `PATCH` notified riders on the mere *presence* of a field in the body, so resaving an untouched
  form pushed "Departure changed" to five phones (and, once the waiver existed, would have handed out
  a free cancellation for nothing) — it now diffs against the stored row via `src/domain/tripEdit.ts`,
  comparing times as instants so `…Z` and `…+00:00` don't read as a change; and a rider looking at a
  **cancelled** trip still saw "✓ You're riding this trip" over a Leave button the API answers with
  `409` — it now says what happened and why. `PATCH` also gained `409 capacity_below_riders`.
- Recorded as **[D-38]** with four questions for the developer, **one answered the same day**: a
  `started` trip stays uncancellable by design — "this is not a communicating platform as it is a
  coordinating platform. If something goes bad, they can be notified in other way." Verified benign:
  the 6h auto-close never touches `points_ledger`, so nobody is charged for a ride that stopped
  happening. Still open: whether the waiver expires, how small a change still counts, and whether a
  serially-cancelling driver is accountable at all.

## Also this session (verification)
- **Migration `0016` is applied and D-38 is verified end-to-end against the live database.** The
  developer's first attempt had not reached the project — proven, not inferred, by the trip detail
  route answering `500 rider_lookup_failed / "column trip_rider.penalty_waived_at does not exist"`
  with no remote row in `migration list`. `supabase db push --linked` then applied it, and the
  full e2e suite is **5/5 green**, including the new D-38 spec.
- **Two bugs found by trying to verify, both fixed and committed separately from the feature.**
  (1) `GET /api/trips/:id` and `POST .../leave` destructured only `data` from the `trip_rider`
  query, so a failed query read as "nobody has joined": the detail screen answered **200 with an
  empty car** and offered a rider "Request to join" for a seat they already held, and `leave`
  answered `404 "You're not riding this trip"` to someone who was. That silent failure is what made
  a missing column look like a stale UI, and it is what CLAUDE.md §3.5's "no swallowed errors" is
  for. (2) `core-loop.spec.ts` (gate **G5**) has been **red since D-35 shipped** — every spec
  publishes a round trip, and answer (C) put a mandatory "Coming back too?" sheet in front of that
  join, so the spec waited for a confirmation that could not arrive. Fixed with a `joinTrip()`
  helper that answers the question.
- **New spec `tests/e2e/trip-edit-cancel.spec.ts`** covers the whole D-38 flow against the real
  database, and is written so it cannot pass vacuously: the rider is charged −5 for leaving an
  **unchanged** trip inside the window, then rejoins the **same** trip and leaves again after an
  edit — same rider, same trip, same distance from departure, only the edit differs. It also asserts
  the untouched-save no-op, `notifiedRiders`, the rider-facing wording both ways, and that both
  notification rows actually reached the rider.

## In Progress
- Nothing mid-flight.

## Next
- **Deploy.** The migration is live and `main` is 6 commits ahead of production; nothing else gates
  the release.
- [D-38] (c): an "abandon" path from `started`, if the developer wants one.

## Blocked On
- [D-38] questions (a)-(d) — none block the shipped behaviour, all four change it if answered
  differently.
- Unchanged: [D-21] (Vault secrets, so `/api/cron/tick` still has no caller), custom SMTP, and the
  Supabase URL config.

## Gates Green
- G1 (`pnpm verify`): typecheck, lint and **195/195** tests green (11 new in `tripEdit.test.ts`).
  Same pre-existing `next lint` custom-font warning, still non-blocking.
- **G5 is green for the first time since D-35 shipped**, and had been red without anyone knowing —
  two causes, both fixed here: the mandatory "Coming back too?" join question, and `.card` first()
  picking the newly-materialised return leg instead of the closed outbound the kudos step is about.
- **Full e2e suite 5/5 green against the live database**, including `trip-edit-cancel.spec.ts`:
  the −5 charge on an unchanged trip, `changed: []` on an untouched save, `notifiedRiders: 1` on a
  real edit, the waived leave (`latePenalty: null`, `penaltyWaived: true`), the cancellation reason
  reaching the rider verbatim, and both notification rows actually delivered.

## Shipped (2026-08-30 — trip times rendered in the reader's time zone, not the server's)
- **The bug (developer, from production): a ride published for 7:45 read back as 14:45.** Storage was
  never wrong — `depart_at`/`return_at` are `timestamptz` and the browser sends a correct absolute
  instant. The *rendering* was wrong: `formatTripTime`/`dayLabel` used `getHours`/`getDate`, i.e. the
  clock of whatever runtime called them. Those run on the server, and the server on Vercel is UTC, so
  every time on every card was shifted by the reader's UTC offset — exactly 7h in `America/Los_Angeles`.
  Invisible in `next dev`, where the server and the browser share one zone, which is why it survived
  every previous manual pass.
- **`src/domain/tripDay.ts` is now zone-explicit** — `formatTripTime(date, tz)`, `dayLabel(date, now, tz)`,
  a shared `zonedParts()` on memoised `Intl.DateTimeFormat`s. No function in it can read a local clock
  any more, so this class of bug cannot come back by omission: leaving the zone out is a type error.
- **The zone travels browser → server in the `carpool_tz` cookie.** `<TimeZoneSync/>` (mounted in the
  root layout) writes the browser's IANA zone on mount and `router.refresh()`es if it changed;
  `viewerTimeZone()` reads cookie → Vercel's `x-vercel-ip-timezone` → UTC. Chosen over formatting in
  the client so the server-rendered HTML is already right: no post-hydration flicker, no mismatch.
- **`TripView` gained `departAt`** (the instant behind the strings), and the Carpools feed now sorts by
  it. It was sorting `a.time.localeCompare(b.time)`, which puts "7:45" *after* "17:30" — a second,
  quieter time bug in the same code.
- **Regression cover at both levels.** Unit: the same instant renders 7:45 / 14:45 / 16:45 in LA / UTC /
  Madrid, DST included, plus the day-boundary case where one instant is Monday in California and
  Tuesday in UTC. E2E (`tests/e2e/trip-time.spec.ts`): the browser context is pinned to Europe/Madrid
  and the spec asserts a published ride reads back at the time it was published for — run against a
  dev server forced to `TZ=UTC`, which is the production shape, and green.
- Recorded as **[D-37]**: rendering in the *reader's* zone is what shipped; a group-owned zone is the
  alternative, and the only case they differ is a member away from the route.

## In Progress
- Nothing mid-flight.

## Next
- **Deploy** — this fix is worthless until it is on Vercel, and that is exactly where the bug lives.
- D-37's remaining question for the developer: reader's zone (shipped) vs a `group.time_zone`.

## Blocked On
- Nothing for this fix. [D-21] (Vault secrets for the tick) and the D-30/D-36 backlog are unchanged.

## Gates Green
- `pnpm verify`: typecheck + lint + **184 tests** (14 suites; 18 new/rewritten across `tripDay`,
  `toTripView`, `timeZone`). Same pre-existing `next lint` font warning.
- `pnpm build`: clean.
- `tests/e2e/trip-time.spec.ts`: 1/1 against a `TZ=UTC` server with a Madrid browser.

## Shipped (2026-08-30 — D-35 first slice: the round trip's return leg becomes a real trip)
- **Migration `0013_round_trip_back_leg.sql`.** `trip.parent_trip_id` with a unique partial index —
  load-bearing, because four separate paths can now ask for a return leg and nothing else on the row
  records that it already exists. `trip_rider.wants_return`. `join_trip()` re-signed to carry the
  answer (old 2-arg version dropped, so a caller that forgets fails loudly). New
  `generate_back_trip()`: locks the parent, returns an existing leg unchanged, **adopts** a
  hand-published `back` trip at the return hour rather than duplicating it (the D-36 collision), and
  seats confirmed riders who declared a return, oldest first, up to remaining capacity.
- **Close is no longer driver-only** (D-35 mechanic (i)). `transition()` gained `not_permitted` and a
  `closeMode`; the **group admin** gets the **restricted** close — confirms everyone, marks nobody a
  `no_show`, ignores the body's guests — and it **pays the driver the full award** (answer (A)).
  The three close callers now share one `src/lib/api/closeTrip.ts` so they cannot drift.
  **Corrected same day:** this first went in allowing *riders* to close too, per the original wording
  of mechanic (i). The developer pulled that back — closing moves points and decides who rode, which
  is not one passenger's authority over another. Riders are out; driver and admin only.
- **`force-close` stopped being points-free**, deliberately. Its old "never touches `points_ledger`"
  rule does not survive D-35: a forgotten close would cost the driver both legs. Started trips take
  the restricted close; `scheduled` trips keep the old status-only behaviour.
- **Kudos is per ride, not per leg** (answer (B)). The outbound close prompts only riders who are
  *not* returning; returning riders are prompted when the back leg closes. The kudos route rejects a
  kudos already given on the sibling leg — `unique (trip_id, from_profile_id)` cannot see across two
  rows — and scales the award by the **fuller** leg via `confirmedRiderCountForRide()`.
- **The join question is asked outright** (answer (C)): `wantsReturn` is required with no zod default,
  so a join that never asked is a 400. New `ReturnQuestionSheet` with two equally-weighted answers and
  no pre-selection, wired into both join paths (the card's quick-join and the detail overlay).
- Docs: `docs/API.md` updated for all four changed endpoints in the same commit; D-35 in
  `docs/DECISIONS.md` carries the four answers and the four contradictions found against built code.

- **D-35 mechanic (ii) — T−2h auto-generation, built 2026-08-30.** `/api/cron/tick` grew a second
  job: a `round` trip still `started` within 120 minutes of its `return_at` and owed a leg gets the
  restricted close from the scheduler — driver paid, leg materialised, `cron_generate_return_leg`
  in `audit_log` with a null actor. `isSystem` on the transition actor; `profileId` is now optional,
  and an actor with neither id nor flag is refused.
- **The ordering bug that fell out of it.** The 6h auto-close would have beaten the deadline on every
  ordinary commute (out 08:00, back 18:00 → stale 14:00, due 16:00), closing the outbound for zero
  points and leaving the return unbuilt. Generation now runs first and the auto-close skips any round
  trip still owed a leg.

- **Shim dropped 2026-08-30 (migration `0015`), applied.** The developer confirmed the live join
  sheet asks the return question, which closed the deploy window the two-argument `join_trip` existed
  for. Verified by regenerating types to a scratch file: `join_trip` is a single three-argument
  function with no overload. Repo and database are in sync — `db push --dry-run` reports up to date.
- **Deployed 2026-08-30.** All seven commits pushed to `origin/main` (`2e1d00e..8021e49`), which is
  what Vercel builds from. `pnpm build` was run locally first so a broken production build could not
  be the way we found out. The live site answers 200. **Which commit is actually serving cannot be
  confirmed from outside** — that needs the Vercel dashboard, or the user-visible tell: the join
  sheet on a round trip now asks whether you are coming back.

- **Migration `0014` (backfill `wants_return`) was written, then DELETED unapplied on 2026-08-30.**
  Written because 0013's `default false` silently reassigned the return seat of anyone who joined a
  round trip before the question existed. The developer confirmed **no such riders exist** — nobody
  had joined a round trip yet — so there was nothing to repair. It was deleted rather than left in
  place because an unapplied copy had become actively dangerous: it flipped `false` to `true` for
  every active rider on an open round trip, with no time bound, and now that the build is live
  `false` means "asked, and said no". Any later `db push` would have picked it up and seated people
  on a return leg they had explicitly declined. **If a pre-D-35 rider is ever discovered, the fix is
  a fresh migration bounded to `joined_at` before 0013 was applied — not this one.**

## In Progress
- Nothing. The slice is complete and `pnpm verify` is green.

## Next
- ~~Apply migration 0013~~ **DONE 2026-08-30.** Pushed to the linked project; `migration list` shows
  0013 on both sides and the remote reports up to date. A **deploy shim** went in before the push:
  the two-argument `join_trip` survives as a delegation passing `false`, because the live build still
  calls it and dropping it would have broken every join until a redeploy. **Owed: a migration that
  drops the shim once the new build is live.**
- **Do NOT run `pnpm db:types:linked` expecting a clean result** (generate to a scratch file instead
  — that is how 0015 was verified without touching the committed types). It was run and reverted. The CLI
  emits `string` for every CHECK-constrained text column, flattening the hand-narrowed unions
  (`trip.status`, `trip.direction`, `profile.platform_role`, `trip_rider.state`, `points_ledger.kind`,
  `notification.type`) the rest of the app type-checks against — 5 type errors immediately. The header
  of `src/types/database.ts` says as much; the file is deliberately hand-maintained. Its entries were
  diffed against the freshly generated output and match the live schema exactly.
- **Verify the loop end-to-end against the live project**: join a round trip both ways, close the
  outbound, confirm the back leg appears with the right riders and the decliner's seat is free.
  The schema is live now, but `generate_back_trip()` has still never actually executed.
- **Prove the tick in production.** Mechanic (ii) is built but has never run on a schedule — the
  Vault secrets are what stand between it and a real tick. Until then an **admin noticing** is still
  the only safety net for a forgotten close.
- Then **D-36** (the same-hour publish key — still needs the developer's answer), then D-31/32/33.

## Blocked On
- **The Supabase Vault secrets** (D-21) — the developer said they would fix this on 2026-08-30.
  Mechanic (ii) is now written, so the secrets are the last thing between it and a live scheduler:
  with no caller, no tick, and the generator never runs.
- **D-36's key** is undefined (driver + hour, ± group, ± direction). `generate_back_trip()` adopts an
  existing same-hour back trip so the generator itself is safe either way, but the publish-side rule
  cannot be built without it.
- `CLAUDE.md` §4 still reads "Kudos: one per rider per **trip**" while the decision is per **ride** —
  that file is immutable to the agent, so the developer edits it by hand (same as the stale D-19
  scoring line).
- Unchanged: custom SMTP (D-22), the Supabase URL config.

## Gates Green
- G1 (`pnpm verify`): green — typecheck, lint, **172/172 tests** across 13 files.
- G3 (trip state machine): the exhaustive matrix still passes and now covers the non-driver close —
  a rider and a group admin get `restricted`, the driver keeps `full`, a stranger gets
  `not_permitted`, and opening close did **not** open `start`/`cancel` (asserted).
- G8 (API docs): every changed route re-documented in the same commit.
- **Not claimable yet**: nothing in this slice has run against a real database. Migration 0013 is
  unapplied, so `generate_back_trip()` has never executed — the SQL is reviewed, not verified.

## Shipped (2026-08-28, later — backlog corrected and re-prioritised by the developer)
- **D-34 was recorded wrong and is rewritten.** The first reading had it as "each trip picks its own
  destination". The developer's actual intent is an **event model**: large groups with no fixed
  destination, where someone **creates an event** and **cars subscribe to it**. That means a new
  `event` entity between group and trip (`trip.event_id`), not an origin/destination override on the
  existing trip. Also **downgraded — explicitly not a priority.**
- **D-30 now carries the developer's own mechanics.** Joining a trip with open seats **asks whether
  you are returning on it too**; outbound riders hold **priority** on the return seats; a
  return-only booking is refused **until the outbound leg is closed**, and only the seats still free
  at that point open to everyone else. Reserved, not first-come.
- **D-35 opened, and it outranks everything** — the developer called it "more urgent than the one
  leg trip". A round trip has two departures but the lifecycle has a single `started_at`/`closed_at`,
  which breaks in five identified places: Start is ambiguous, points pay out at close, D-16's T−2h
  guard is measured off `depart_at`, the 6h auto-close would close a trip whose return has not run,
  and D-23's 24h expiry would expire it mid-day. **D-30 depends on it** — its "until the outbound is
  closed" cutoff is defined in terms of whatever D-35 decides.

## In Progress
- Nothing.

## Next
- **Detail D-35 first, then D-30.** The developer's standing instruction (2026-08-28): when they ask
  "what's next", begin *specifying* the recorded backlog rather than re-listing it.
- Priority order as it now stands: **D-35** (most urgent) → **D-30** (soon) → **D-31 / D-32 / D-33**
  (mid) → **D-34** (not a priority).

## Blocked On
- D-30 through D-35 all need developer answers before implementation.
- Unchanged: custom SMTP (D-22), the Supabase URL config, the scheduler's Vault secrets.

## Gates Green
- G1 (`pnpm verify`): green — typecheck, lint, 144/144.


## Shipped (2026-08-28 — D-29 complete and deployed; five new items opened)
- **Pushed.** 14 commits went to `origin/main` (`1e811bd..010e562`), the first push in several
  sessions. This clears item 4 of the pending-manual-checks list: local `main` and production are
  no longer divergent, so D-23/D-24/D-25/D-27 and D-29 all reach users on the next deploy.
- **D-29 is live end to end.** The developer added the Gym stop to MBA 2028 themselves; confirmed in
  the live data as `kind='stop'`, `icon='gym'`, address `UCLA`, sitting alongside the two untouched
  pickup places. The create-trip form's `+ Add a stop` will now appear for that group.
- **Removed `_preview-stops.html`**, the throwaway design preview. It was never tracked, so nothing
  left the repo with it.
- **Five new decisions opened, from the developer's own backlog** (`docs/DECISIONS.md`):
  **D-30** one-way riders on a round trip so return seats free up (**urgent**), **D-31** the Snitch,
  **D-32** a per-trip feedback form, **D-33** a group feed with photos, **D-34** dynamic/open groups
  with per-trip destinations (**high**). None started — each carries the analysis and the specific
  questions that are the developer's call.

## In Progress
- Nothing.

## Next
- **D-30 first** — it is the developer's urgent one, and it is the only one of the five that changes
  an existing locking contract (`join_trip()`'s `select ... for update` capacity check). It also
  needs its four answers before code: points weighting for a one-leg rider, the late-cancellation
  charge, whether return-leg-only joining is allowed, and whether two one-way trips already suffice.
- **D-34 next by size** — it amends `CLAUDE.md` §4's "route is owned by the group", and interacts
  with D-30 because per-leg seats presuppose legs.

## Blocked On
- D-30 through D-34 all need developer answers before implementation.
- Unchanged: custom SMTP (D-22), the Supabase URL config, the scheduler's Vault secrets.

## Gates Green
- G1 (`pnpm verify`): green — typecheck, lint, 144/144.


## Shipped (2026-08-27 — D-29 live: migration 0012 applied, feature complete)
- **Migration `0012` applied to the live project** (`supabase db push --linked`, developer
  authorised). This was the last blocker; every other piece of D-29 was already built and inert.
- **Verified against the live database**, 12 checks, all passing: the two existing MBA 2028 pickup
  places defaulted to `kind='pickup'` with a null icon; a stop without an icon, a pickup carrying
  one, and an icon outside the vocabulary are all rejected; an out stop on a `back` trip and a
  return stop on an `out` trip are rejected; a round trip with an outbound stop is accepted; the
  feed's select resolves every new column and round-trips the stop id; the stop-list query returns
  only stops; and deleting a place **nulls** the trip's stop rather than blocking the delete. All
  test rows removed afterwards.
- **The tag's final shape**, after three rounds of developer notes: place name on top, leg as a
  centred arrow underneath — straight for outbound, sideways U-turn for the return. `in way`/`back`
  remain as `sr-only` text and the tag `title`, so an arrow-only signal doesn't strand screen
  readers. The U-turn points **left**; the literal -90° the developer named lands the head pointing
  right, which collides with the outbound arrow.
- `src/types/database.ts` needed no regeneration — the new columns were already hand-patched with
  the literal unions the generator can't infer from a CHECK.

## In Progress
- Nothing.

## Next
- The group admin adds a real stop to MBA 2028 (Group tab → Stops → **+**, name it, pick an icon).
  Nothing appears in the create-trip form until a group has at least one.

## Blocked On
- Nothing for D-29. Unchanged elsewhere: custom SMTP (D-22), the Supabase URL config, the
  scheduler's Vault secrets. Phase 6 (Maps) stays deferred behind D-03.

## Gates Green
- G1 (`pnpm verify`): green — typecheck, lint, 144/144.
- G8 (API docs): `docs/API.md` documents the stop fields on every affected route.


## Shipped (2026-08-27 — stop mention right-aligned; D-29 primitives added to the styleguide)
- **The mention moved to the right end of the route row**, opposite the `from → to` it qualifies,
  instead of sitting on its own line beneath it. The card no longer grows a row per stop. Two stops
  on a round trip stack at the right edge rather than running on, so the right margin stays readable.
- **`/styleguide` gains a "Trip stops (D-29)" section** (`src/app/styleguide/StopDemo.tsx`), which
  renders the **real** components with mock props rather than copied markup: the eight-icon
  vocabulary, the add-trip stop pickers (live — changing them updates the card below), and the
  resulting card. This is the page's job, and a copy stops being comparable the moment the real
  component changes — the same drift that had already happened once with the route line.
- **`StopPicker` moved out of `CreateTripOverlay` into `StopSign.tsx`**, next to the rest of the D-29
  UI, so the form and the styleguide share one control instead of two that can diverge.
- Verified live: six route rows render with the mention right-aligned — `Gym before arriving`,
  `Pool on the way home`, `Coffee before arriving`, two direct rides showing nothing, plus the
  interactive demo card. 144/144 tests.

## In Progress
- Nothing. Awaiting review of the right-aligned placement.

## Next
- Apply migration `0012`, then walk the real flow: add a stop as admin → publish a trip through it.

## Blocked On
- **Migration `0012` is still not applied** — `supabase db push --linked` was denied by the sandbox's
  permission classifier. Confirmed absent by probing the live project. All D-29 code is inert until
  it runs, and the Carpools tab will error against the current live schema.
- Unchanged: custom SMTP (D-22), the Supabase URL config, the scheduler's Vault secrets.

## Gates Green
- G1 (`pnpm verify`): green — typecheck, lint, 144/144.


## Shipped (2026-08-27 — D-29 stop mention resized and reframed)
- **It is not a warning.** The notice was a bordered amber block led by a warning triangle; the
  developer's read was that it was too big for the card and that a stop isn't an alert — "it is just
  to communicate that they will do something before arriving". `StopWarning` → `StopMention`: no
  box, no border, no triangle. A small tinted chip carries the icon and name, muted text after it
  carries the timing, and the whole thing sits under the route line at 10.5px instead of 11.5px in
  an 8px-padded bordered block.
- **Wording is now keyed to the leg, not to the trip shape.** Was `on the way` / `on the way there` /
  `on the way back`, qualified by whether the ride had two legs. Now `before arriving` for an
  outbound stop and `on the way home` for a return one — phrased against the destination the rider
  is actually placing the stop against, and identical on a one-way and on a round trip's matching
  leg, so one less rule to hold.
- Verified live on `/styleguide`: `Gym before arriving`, `Pool on the way home`,
  `Coffee before arriving`, and two direct rides showing nothing. 144/144 tests.

## In Progress
- Nothing. Awaiting the developer's review of the resized mention.

## Next
- Apply migration `0012`, then walk the real flow: add a stop as admin → publish a trip through it.

## Blocked On
- **Migration `0012` is still not applied** — `supabase db push --linked` was denied by the sandbox's
  permission classifier and has not been retried. Confirmed still absent this session by probing the
  live project (`column trip.out_stop_id does not exist`). Everything D-29 is inert until it runs.
- Unchanged: custom SMTP (D-22), the Supabase URL config, the scheduler's Vault secrets.

## Live data, checked this session (read-only)
- **MBA 2028** (`Q8JB2X`, UV → UCLA): 3 members — Alejandro Rivera, sjlarrain (admin), Isa — with
  **2 pickup places** (Sepulveda, Sawtelle) and **0 trips**. Both places will default to
  `kind = 'pickup'` when `0012` runs, so they stay pickup points; the group has no stops yet, which
  means the create form's stop picker stays hidden until the admin adds one.
- Corrects an earlier note in this worklog: `pickup_place` was described as having 0 rows. It has 2.
  Harmless — they satisfy the new constraints — but the migration is not landing on an empty table.
- Clutter left in the live project: three Playwright groups (`E2E Group…`, `Share Group…`,
  `Confirm Group…`) and five test profiles (`Probe`, `Browser Tester` ×2, `E2E Driver`, `E2E Rider`)
  alongside the four real accounts. `pnpm db:reset-data` keeps accounts and groups by design, so it
  will not clear them. Not removed — deleting rows from the live project needs the developer's word.

## Gates Green
- G1 (`pnpm verify`): green — typecheck, lint, 144/144.


## Shipped (2026-08-27 — D-29 presentation reworked: the stop is a warning, not a route segment)
- **The sign moved out of the route line.** It was built as `Riverside → [Gym] → HQ`; the developer
  rejected that and asked for "a **warning** mention that they will be going to the gym". A stop is
  now its own amber notice under the route — warning triangle, the stop's icon, *Stopping at Gym on
  the way there* — and the route line is plain `from → to` again.
- `routeLegs()` / `RouteLeg` / `route` / `returnRoute` are gone, replaced by `stopNotices()` and
  `StopNotice[]` on `DecoratedTrip`. The round trip's second (reversed, dimmed) route line went with
  them: it existed only to show *where* a return stop fell, which the notice now says in words.
  Wording is qualified only when the ride has two legs to tell apart — `on the way` for a one-way,
  `on the way there` / `on the way back` for a round trip.
- `RouteLine` → `StopWarning` in `StopSign.tsx`; the trip detail overlay reads `stopNotices` too.
  Tests rewritten to match (14 in `decorateTrip.test.ts`, 144 total — one fewer than before because
  the two route-line placement cases collapsed into one wording case).
- Verified live on `/styleguide` against real mock data: all five cards render `Riverside → HQ`, and
  the two trips with stops carry `Stopping at Gym on the way there` / `Stopping at Pool on the way
  back` as separate notices. No server errors.

## In Progress
- Nothing.

## Next
- Developer review of the new presentation, then apply migration `0012`.

## Blocked On
- **Migration `0012` is still not applied.** `supabase db push --linked` was denied by the sandbox's
  permission classifier last session and has not been retried since. Everything above is inert until
  it runs — the columns don't exist on the live project, so the trip feed's selects will error.
- Unchanged: custom SMTP (D-22), the Supabase URL config, the scheduler's Vault secrets.

## Gates Green
- G1 (`pnpm verify`): green — typecheck, lint, 144/144 tests.
- G8 (API docs): `docs/API.md` updated for the `stopNotices` shape.


## Shipped (2026-08-27 — D-29 trip stopovers, with the sign on the card)
- **Migration `0012_trip_stops.sql`** — `pickup_place` gains `kind` (`pickup` | `stop`) and `icon`
  (fixed 8-value vocabulary, non-null exactly when `kind = 'stop'`); `trip` gains `out_stop_id` and
  `back_stop_id`, each CHECK-guarded against `direction` in the same idiom as the existing
  `return_at` check. Reusing `pickup_place` rather than adding a table means no new RLS, API or
  admin editor, and its POST route was **already** `group_admin`-only — which is exactly the
  developer's "manager-managed, fixed list" requirement. **Not yet applied to the live project** —
  see Blocked On.
- **Domain** — `TripView` carries `direction`, `outStop`, `backStop`; `routeLegs()` in
  `decorateTrip.ts` decides which line each stop renders on (outbound inline; a round trip's return
  stop gets its own reversed line; a one-way `back` trip needs no second line because its single
  line already *is* the return leg); `stopView()` in `toTripView.ts` narrows the DB's bare `icon`
  string rather than casting, and drops a stop with no recognisable icon. 10 new tests, 145 total.
- **API** — `POST /api/trips` and `PATCH /api/trips/:id` accept `outStopId`/`backStopId`, validated
  by zod for the leg rule and by `src/lib/trips/resolveStops.ts` for the two facts the DB can't
  cheaply enforce: the place belongs to *this* group, and it is a `stop`, not a `pickup` point. A
  stop change now also notifies active riders (`type: "change"`), with copy that says route rather
  than time. `POST /api/groups/:id/pickup-places` takes `kind` + `icon`. `GET /api/me/points`
  returns `stopsThisMonth`.
- **UI** — `StopSign.tsx` draws the 8 glyphs and the amber sign, and renders the route line with the
  stop *inside* it (`Riverside → 🏋 Gym → HQ`) rather than as a badge beside it. Amber deliberately:
  purple and teal already mean "you're driving" and "you've joined". Create form gains a stop picker
  per travelled leg, and renders nothing at all for a group with no stops. Group tab gains a Stops
  section with an icon picker for the admin. Trip detail shows each stop with its address.
- **Knock-on fix the split made necessary:** the You tab's pickup-point selector and the Group tab's
  pickup list both rendered every `pickup_place` row, so a stop would have been offered as somebody's
  home pickup point. Both now filter on `kind`.

## In Progress
- Nothing.

## Next
- Apply `0012` to the live project, then verify the flow end-to-end in a browser (create a stop as
  admin → publish a trip through it → confirm the sign on the card).

## Blocked On
- **`supabase db push --linked` was denied by the sandbox's permission classifier**, so migration
  `0012` is committed but **not live**. Every code path above is inert until it is applied — the
  columns don't exist yet, so the trip feed's `pickup_place`/`trip` selects will error against the
  current live schema. The developer needs to run it (or grant the permission).
- Unchanged from before: custom SMTP (D-22), the Supabase URL config, the scheduler's Vault secrets.

## Gates Green
- G1 (`pnpm verify`): green — typecheck, lint, 145/145 tests (was 135). Same pre-existing
  `next lint` custom-font warning, still non-blocking.
- G8 (API docs): `docs/API.md` updated in this commit for all five changed endpoints.


## Shipped (2026-08-26 — analytics raised, recorded as D-28, nothing built)
- **D-28 opened** in `docs/DECISIONS.md`: the developer asked whether PostHog could be used for
  product analytics. Answer is yes on feasibility — Next 15 App Router + Vercel + PWA is a supported
  combination, `next.config.mjs` has no CSP to amend, `public/sw.js` has no `fetch` handler to fight,
  and the free tier is far above this app's volume. **Deliberately not built:** an analytics SDK is
  a new third-party service, which `00_DEV_ENVIRONMENT_SETUP.md` forbids by default and
  `02_IMPLEMENTATION_PLAN.md` §7 lists as out of scope. No packages installed, no code touched.
- The entry records the full implementation shape so it can be picked up cold, plus the three
  sub-questions that are the developer's call and not an engineering one: **region** (EU vs US is
  permanent per project, and this data is colleagues' home pickup locations), **session replay**
  (records real coworkers' screens — a consent conversation), and **scope** (client-only capture
  undercounts, because a PWA on a commute drops events).

## In Progress
- Nothing.

## Next
- Nothing queued. D-28 stays open until the developer answers it; Phase 6 (Maps) remains deferred
  behind D-03's traction precondition.

## Blocked On
- D-28 — needs a yes/no plus the region and replay calls before any analytics code can be written.
- The manual items that need a real person: custom SMTP (D-22 — registration mail is broken without
  it), the Supabase URL config, and the scheduler's Vault secrets.

## Gates Green
- G1 (`pnpm verify`): untouched this session — docs-only change, no code modified.

## Shipped (2026-08-26 — activity data cleared, reset script added)
- **Cleared the live project's activity data** at the developer's request. Gone: `kudos` (1),
  `points_ledger` (3), `trip_rider` (3), `trip` (5), `notification` (12), `audit_log` (6),
  `feedback` (1), `rate_limit_hit` (8). Kept, on the developer's explicit choice: `auth.users`,
  `profile` (9), `"group"` (4), `membership` (8), `pickup_place` (0), `push_subscription` (2) —
  so every account stays signed up to its group and push stays registered.
- **`scripts/reset-data.ts` + `pnpm db:reset-data`** does it repeatably. Service-role client reading
  `.env.local` (same shape as `bootstrap-admin.ts`), deletes ledger-before-trip because
  `points_ledger.trip_id` has no `on delete cascade`, refuses to run without `--yes`, and `--dry-run`
  prints the row counts without touching anything. README's scripts table and structure block updated.

## In Progress
- Nothing.

## Next
- Phase 6 (Maps) remains the only unshipped phase; otherwise polish.

## Blocked On
- The manual items in `docs/DECISIONS.md` that need a real person: custom SMTP (D-22 — registration
  mail is broken without it), the Supabase URL config, and the scheduler's Vault secrets.

## Gates Green
- G1 (`pnpm verify`): green — typecheck, lint, 135/135 tests.

## Shipped (2026-08-26 — seven fixes from the developer, five new decisions)
- **The tab bar stays on the bottom edge** (`6fef957`). The shell was `min-height:100vh` with the bar
  in normal flow, so a long trip list grew the document and pushed the bar off screen. The shell is
  now exactly one viewport tall (`.appshell`, `100dvh` with a `100vh` fallback) and the content
  scrolls inside it. The Group tab needed its own `.scroll` wrapper — it was the one screen relying
  on the document to scroll for it. Tab-bar padding now clears the iOS home indicator.
- **Renamed to Karpool** (`3e5f5be`, D-26) across every visible string, the manifest, the service
  worker's push fallback title and the README. `package.json`, the repo folder, doc filenames and
  internal keys (the install prompt's `localStorage` entry) deliberately unchanged.
- **Install flow rebuilt** (`e619e5d`). Was iPhone-only and text-only. Now `src/domain/installPlatform.ts`
  (pure, 8 tests over real UA strings incl. the iPad that claims to be a Mac) names the device, and
  `InstallCard` offers a real one-tap Install where `beforeinstallprompt` exists (Android Chrome/Edge,
  desktop Chromium) plus an ⓘ with per-device steps everywhere. **iOS can never have the button** —
  Apple exposes no install API — so there the steps are the feature.
- **Unstarted trips expire; finished trips collect under Past** (`9b63fb4`, D-23/D-27). Joining stops at
  `depart_at`; the driver keeps the trip 24h longer (start it, close it, add passengers); still
  unstarted at +24h and the scheduler ends it `cancelled`/`not_started`, notifies everyone, audits it,
  and awards nothing. Reads "PAST · NEVER STARTED", never "CANCELLED". The Carpools tab's new Past
  section (last 30 days) also fixes the kudos prompt becoming unreachable 24h after a close.
- **Drivers can seat a group member** (`a91ce0f`, D-24) from a picker, through `add_trip_rider()` with
  the same row lock as `join_trip()`. The seat counts against capacity, the member is notified, and
  leaving a seat they never booked costs them nothing. The driver can only take back seats they added.
- **Feedback form + admin tab** (`37c9cd7`, D-25). Profile tab → sheet → `POST /api/feedback` → Postgres
  → new admin Feedback tab. Not email: no SMTP exists (D-22).
- **Drivers can pick the day of a trip** (`8a486ba`). Found by the e2e suite going red: the create form
  only ever sent "today at HH:MM", so tomorrow morning's commute could not be published the evening
  before. Harmless while past-dated trips stayed joinable; a dead trip once D-23 landed. The specs
  were leaning on the same bug (a fixed "07:45 today", in the past on any run after 07:45) and now
  publish 60 minutes out through a shared `publishTrip()` helper that rolls onto tomorrow near
  midnight.
- **Onboarding and share link re-checked** (the developer asked): `pnpm e2e` green (3/3), plus a manual
  pass — signed-out `/j/CODE` shows the group and prefills the code, signing in joins and lands in the
  group, and `/t/:id` redirects a member into the trip overlay.

## In Progress
- Nothing mid-flight.

## Next
- **Deploy.** Nothing from this session (or the four commits before it) is on Vercel; pushing needs
  authorisation. Migrations `0010`/`0011` are already applied to the live Supabase project, so the
  database is ahead of the deployed app — harmless (both are additive) but worth closing.
- Edge cases raised with the developer and not yet decided: driver-declared points are unverifiable
  (a driver can confirm no-shows and invent guest names, both of which raise their own score); a
  cron auto-closed trip awards its honest driver nothing; a driver cancelling on ten riders pays no
  penalty while a rider leaving late pays −5; a driver leaving the group with live trips; the last
  group admin leaving; day grouping computed in the browser's timezone vs cron in the server's.

## Blocked On
- D-03 (Maps) — deferred indefinitely, business precondition, do not re-propose.
- D-17 (comment notification type) — still open, still no UI to build.

## Gates Green
- `pnpm verify`: typecheck + lint + **135 tests** (12 suites; 6 new this session across
  `installPlatform`, `decorateTrip`, `toTripView`). Same pre-existing `next lint` font warning.
- `pnpm e2e`: 3/3 (core loop, share link, signup confirmation).
- Live-verified against the real database and the running app: tab-bar pinning under a full feed and
  on the Group tab; device detection + ⓘ steps; feedback POST (201); add/remove passenger; the
  expiry sweep (25h-old trip expired, 2h-old survived, audit row written, both parties notified);
  the departure guard; driver-add-after-departure; and both link entry points.
- **Not verified live:** the admin console's Feedback tab — checking it needs a platform-admin
  session, and promoting a test account was blocked by this environment's permissions. The route
  follows `/api/admin/audit-log` exactly and typechecks; it wants one look from the developer.
- Note for the record: the tab-bar commit (`6fef957`) carries one stray line of the feedback wiring
  (`AppShell` passing `groupId`), so that one commit's tree does not typecheck in isolation. HEAD is
  green; commits are never rewritten here (`CLAUDE.md` §3.2), so it stands as a known blemish.

## Shipped (signup 400 traced to Supabase's built-in mailer)
- **The production signup failure is diagnosed and reproduced.** A real user's registration returned
  400 with `email rate limit exceeded` under the form. Root cause: no custom SMTP, so the project is
  still on Supabase's built-in sender, which delivers **only to the Supabase project's team members**
  and allows **2 messages an hour project-wide**. The developer's own signup worked and ate the
  allowance — which is exactly why this looked like "works for me".
- **The developer's URL Configuration was not the cause** (they asked): the Redirect-URLs entry is
  the one verified working on 2026-08-24. Two real defects there anyway, both one step later than the
  400 — **Site URL is set to `https://karpool-nu.vercel.app/auth/callback`** and must be the bare
  origin (a path doubles inside the `{{ .SiteURL }}` template into `/auth/callback/auth/callback`),
  and the allow-list is still missing `http://localhost:3000/auth/callback` and
  `https://*.vercel.app/auth/callback`.
- **Fixed the part that was ours** (`adb95de`): `POST /api/auth/signup` answered every Supabase
  error with a flat `400 signup_failed` carrying Supabase's internal wording to the UI, so a
  project-wide mail outage was indistinguishable from a typo — that is how this went unexplained.
  New pure `src/domain/authError.ts` classifies: 429 rate-limited, 502 not-authorized / delivery
  failed, 403 signups disabled, 409 email taken, 400 only for a genuinely bad email or password.
  Human copy in `message`, Supabase's original in `detail`. 11 new tests; `docs/API.md` lists every
  code. Verified live in the browser — the form now reads "That email address doesn't look valid."
- README: new deploy step 5 (custom SMTP, and raising the mail rate limit afterwards), and step 4
  now says plainly that Site URL is the origin and nothing more.

- **D-22 decided: email confirmation is off.** Rather than wait on SMTP, the developer disabled
  *Confirm email* so signup returns a session immediately. Nothing in the app broke — the
  confirmation email is the only email it sends (there is no password-reset flow anywhere in the
  codebase), and `AuthGate` already branched on `needsEmailConfirmation`.
- **Invited visitors now skip the group-code step** (`5fb19f2`). Someone arriving on `/j/CODE` had
  already chosen their group, and that route joins them itself once a session exists — step 2 was
  asking them to confirm a code they never typed. They now refresh straight back into `/j/CODE` and
  land in the group. Anyone registering from `/` still sees step 2; it is the only place a code can
  be entered.
- **Caught live while testing: the Email provider's master toggle had been switched off** instead of
  the *Confirm email* sub-toggle, which locks out registration *and* every existing user's sign-in.
  The classifier missed it — Supabase says "Email signups are disabled" / "Email logins are
  disabled", neither matching the "signups not allowed" it looked for — so the most damaging
  misconfiguration available fell through to a generic 400. Fixed and tested (`ba970a4`); it is a
  403 now, verified against the running app.

## In Progress
- **Blocked on the developer, and production is currently down for all sign-ins:** the Supabase
  Email provider is still disabled (`POST /api/auth/signup` on production answers "Email signups
  are disabled" as of this session's end). Authentication → Sign In / Providers → Email: turn
  **Enable Email provider** back on, leave **Confirm email** off.
- **Nothing from this session is deployed.** Four commits sit on local `main`; Vercel still serves
  the old flat-400 signup and the old step-2 flow. The invited-visitor auto-join and every improved
  error message are local-only until someone pushes.

## Next
- **Developer action, and registration stays broken for everyone else until it happens:** configure
  custom SMTP in Supabase → Authentication → Emails → SMTP Settings (`README.md` deploy step 5), then
  raise Authentication → Rate Limits → *Rate limit for sending emails* above the built-in 2/hour.
- **Developer action:** fix Site URL to `https://karpool-nu.vercel.app` and add the localhost and
  `*.vercel.app` callbacks to the Redirect-URLs allow list.
- **Developer action, still outstanding:** the two Vault secrets, or the scheduler stays inert.
- Once SMTP is live, the real-mailbox signup round trip finally becomes testable — that is the last
  unproven step of the onboarding fix.
- `CLAUDE.md` §4 is still stale (D-19 scoring) — immutable to the agent, developer edit.

## Blocked On
- **D-03** — Maps, deferred until the app shows real traction (paid API).
- **D-17** — the `comment` notification type renders in the bell but nothing can create one.

## Gates Now Green
- G1 (`pnpm verify`): typecheck, lint, 120/120.

## Shipped (D-21 scheduler on pg_cron; production signup verified)
- **D-21 decided and built** (`505874a`). Developer picked Supabase `pg_cron` + `pg_net` over an
  external pinger. Migration `0008` schedules `carpool-tick` every 5 minutes to post to
  `/api/cron/tick`, which restores T-15min departure reminders and the 6h auto-close of abandoned
  `started` trips. **Neither the URL nor the secret is in the repo** — both live in Supabase Vault
  (`carpool_tick_url`, `carpool_cron_secret`), read at call time, and the job returns without
  calling anything while either is missing, so a half-configured project never fires an
  unauthenticated request at an unknown host. Both migrations are applied to the live project; the
  job is scheduled, active, last run succeeded.
- **Migration `0009` is the lesson from how D-21 broke:** an empty auto-close list means either
  "nothing was abandoned" or "the scheduler is dead", and for weeks it meant the second with nothing
  to show for it. `carpool_cron_status()` now surfaces the job — scheduled / active / last run /
  last status — through `GET /api/admin/health`, with `stale: true` after four missed ticks.
  Verified live: real admin session, real payload (`lastStatus: "succeeded"`, `stale: false`).
  Admin suite green (14/14, G9/G10).
- **The onboarding fix was verified against production**, not just locally: a real confirmation token
  through the deployed `/auth/callback` set the session cookie, redirected `/j/CODE` → `/app?g=…`,
  created the membership in the right group, and marked the email confirmed. The developer's
  Redirect-URLs allow-list entry works — Supabase honoured our `redirect_to` rather than falling
  back to the Site URL.

## In Progress
- Nothing mid-flight.

## Next
- **Developer action — the last mile of the signup fix is still unproven** (deliberately deferred,
  2026-08-24): Supabase rejects made-up domains on public signup, so no agent-run test can prove a
  real confirmation *email* arrives and its link works. Sign up on production with a real mailbox
  once and confirm the link lands you inside the group. Everything either side of the email is
  verified.
- **Developer action:** create the two Vault secrets (`README.md` deploy step 5) or the scheduler
  stays inert — `/api/admin/health` will show `scheduler.stale: true`.
- `CLAUDE.md` §4 is still stale (D-19 scoring) — immutable to the agent, developer edit.

## Blocked On
- **D-03** — Maps, deferred until the app shows real traction (paid API).
- **D-17** — the `comment` notification type renders in the bell but nothing can create one.

## Gates Now Green
- G1 (`pnpm verify`): typecheck, lint, 109/109.
- G5: full e2e suite green in one run (core loop, share link, signup confirmation).
- G9/G10 (admin auth + audit trail): 14/14 against the live project.
- The scheduler that the reminder gate depends on is running again for the first time since Vercel
  Cron was removed — subject to the Vault secrets being set.

## Shipped (share promoted to a black button above the ride's primary action)
- Developer feedback on D-20: the 🔗 in the overlay header went unnoticed. Share is now a full-width
  **black** (`--ink`) button carrying the platform-standard share glyph — an arrow rising out of an
  open tray — sitting directly above whatever action the viewer came for: "Start trip", "End & close
  trip", "Request to join", or the leave button for a rider already on board. Same D-20 access rules:
  still hidden on closed/cancelled rides, the link itself still reveals nothing.
- New `.btnShare` in `components.css` (no hex outside `tokens.css`; `--r-lg` radius like every other
  button). The header icon is gone — one share affordance, not two.
- Verified live in the browser: black `rgb(22,24,29)`, 48px tall, 10px above "Start trip · notify
  riders", and a real click hands the share sheet the right title/text/URL. Full e2e suite green
  (3/3) and `pnpm verify` green (109/109).

## In Progress
- Nothing mid-flight.

## Next
- **Developer action, still outstanding:** add `/auth/callback` to Supabase → Authentication → URL
  Configuration → **Redirect URLs** for each origin (`https://karpool-nu.vercel.app`,
  `http://localhost:3000`, `https://*.vercel.app`) and set **Site URL**. Until then the signup
  confirmation email's link is rejected by Supabase before it reaches the app.
- **D-21** — pick the scheduler. `pg_cron` + `pg_net` is free on every Supabase plan (extensions in
  the project's own Postgres, not metered); the caveat is that a Free-plan project pauses after 7
  days of inactivity and runs no jobs while paused.
- `CLAUDE.md` §4 is still stale (D-19 scoring) — immutable to the agent, developer edit.

## Blocked On
- **D-03** — Maps, deferred until the app shows real traction (paid API).
- **D-17** — the `comment` notification type renders in the bell but nothing can create one.

## Gates Now Green
- G1 (`pnpm verify`): typecheck, lint, 109/109.
- G5: whole e2e suite green in one run (core loop, share link, signup confirmation).

## Shipped (onboarding: signup survives email confirmation; e2e suite green in a full run)
- **The onboarding dead end is fixed** (`5a240b2`). `POST /api/auth/signup` sent no
  `emailRedirectTo` and no callback route existed, so anyone who clicked an invite, signed up and
  confirmed their email landed signed **out** on `/` with the invite code gone — every real new-user
  signup died there. `GET /auth/callback` now exchanges the token for a session and returns the
  visitor to where they were heading (normally `/j/CODE`, which joins the group). Both link shapes
  are handled: PKCE `?code=` (the default template) and `?token_hash=` (the `{{ .TokenHash }}`
  template, which also works when the email is opened on a different device than the one that signed
  up). The invite rides along as `next` **and** as `user_metadata.pending_group_code`, so a template
  that drops the query string still lands the visitor in the right group. A dead or reused link
  redirects to the auth screen with an explanation instead of a blank page.
- `next` is sanitised by a pure `safeNextPath` (absolute, protocol-relative, backslash and
  control-char forms all fall back to `/app`) so it cannot become an open redirect. The return
  origin is the request's own when trusted — localhost in dev, `*.vercel.app` on a preview — instead
  of always the production URL, which is what the first cut got wrong (locally it mailed a link that
  bounced to the deployed site). 16 new unit tests.
- Verified live, not just unit-tested: `tests/e2e/signup-confirm.spec.ts` (`814400f`) mints the real
  confirmation token via the admin API and drives the real callback — invite via `next`, the metadata
  fallback, and the dead-link message. Green.
- **The e2e suite passed file by file but failed as a suite** (`84d9d9f`), for three separate reasons,
  each of which makes a red gate look like a flake: Playwright fans spec *files* across workers even
  with `fullyParallel: false` (two specs drove the same seeded rider at once — pinned to one worker);
  `trip_create` allows 10/hour, so a few runs in a row made every spec fail at "YOU'RE DRIVING"
  (global setup now clears `rate_limit_hit` for the two test accounts only); and `joinGroupByCode`
  waited for `//app/`, which matched the page the rider was already on, so the spec raced past the
  join and the next step saw a non-member. The share link itself was never broken — confirmed by hand
  against the live project.

## In Progress
- Nothing mid-flight.

## Next
- **Developer action, and the fix is inert without it:** in the Supabase dashboard →
  Authentication → URL Configuration, add `/auth/callback` to **Redirect URLs** for every origin
  people sign up on (`https://<domain>/auth/callback`, `http://localhost:3000/auth/callback`,
  `https://*.vercel.app/auth/callback`) and set **Site URL** to the deployed origin. Optionally
  switch the "Confirm signup" template to the token-hash form for cross-device confirmation. Both
  documented in `README.md`.
- **Five commits are unpushed** (this session's three plus D-20's share link and its worklog), so the
  deployed app does not have the ride share button or this fix. Pushing needs authorisation.
- `CLAUDE.md` §4 is still stale (D-19 scoring) — immutable to the agent, developer edit.

## Blocked On
- **D-21** — Vercel cron was removed, so `/api/cron/tick` has no caller: T-15min departure reminders
  and the 6h auto-close of abandoned `started` trips do not run. Supabase `pg_cron` + `pg_net` is
  free on every plan (the extensions run inside the project's own Postgres and are not metered; the
  only caveat is that a Free-plan project pauses after 7 days of inactivity and a paused project runs
  no jobs). Still the developer's pick.
- **D-03** — Maps, deferred until the app shows real traction (paid API).
- **D-17** — the `comment` notification type renders in the bell but nothing can create one.

## Gates Now Green
- G1 (`pnpm verify`): typecheck, lint, 109/109 unit tests.
- G5 (core loop e2e): green — and for the first time the **whole** suite is green in one run
  (core loop, share link, signup confirmation), rather than only spec by spec.

## Shipped (D-20 ride share link; e2e repair)
- **D-20** (`4dccded`) — rides are shareable. The trip detail overlay gets a 🔗 button that opens
  the OS share sheet (`navigator.share`, clipboard fallback), so a ride goes into WhatsApp the same
  way the group invite already did. Developer's call on what the link may reveal: *"they must be
  logged to get the information."* Built stricter than the recommendation — no teaser at all.
  `/t/:id` selects the trip through the **session** client, so RLS is the gate: signed out → the auth
  form, signed-in non-member → a dead end that can't distinguish "no such ride" from "not your
  group", member → `redirect` to `/app?g=…&trip=…`, which opens the overlay and strips `?trip=` from
  the URL on close. A forwarded link grants nothing; the 6-char group code stays the only door.
  Share button hides on closed/cancelled rides (a recipient would land on a dead end).
- Supporting slices, each its own commit: `shareOrCopy()` extracted from `GroupScreen` (`3b30354`),
  the e2e journey helpers extracted from the core-loop spec (`b8d9c84`), pure `rideShareMessage`/
  `rideShareUrl` with 7 tests (seat pluralisation, full car, first vs third person).
- **Found and fixed a red gate:** `tests/e2e/core-loop.spec.ts` had been failing at "rider gives
  kudos" since D-18 (`370c60d`) — the rate card's submit only reads "Send kudos" once the 💚 toggle
  is on. G5 was red and nobody knew. Repaired in `0949e83`, re-run green.
- Verified live, not just unit-tested: `tests/e2e/share-link.spec.ts` drives the whole journey
  against the real project — driver shares (the captured share-sheet payload carries a real
  `/t/<uuid>`), a signed-out context sees only "Sign in to see this ride" with no group name
  anywhere on the page, a signed-in non-member is refused, then the same link opens the ride once
  they join by code.

## In Progress
- Nothing mid-flight.

## Next
- **Onboarding fix, explicitly deferred by the developer (2026-08-22), not blocked:** signup never
  survives email confirmation. `POST /api/auth/signup` passes no `emailRedirectTo` and there is no
  `/auth/callback` route, so a visitor who clicks an invite, signs up and confirms their email lands
  signed-out on `/` with the invite code lost. Fix is `emailRedirectTo` → `/auth/callback` doing
  `exchangeCodeForSession` → `next=/j/CODE`, plus the code stashed in `user_metadata` as a fallback.
  Needs one thing only the developer can do: add the callback URL to the Supabase dashboard's
  redirect allow-list and set Site URL to the deployed origin.
- `CLAUDE.md` §4 is still stale (D-19 scoring) — immutable to the agent, developer edit.

## Blocked On
- **D-03** — Maps, deferred until the app shows real traction (paid API).
- **D-17** — the `comment` notification type renders in the bell but nothing can create one.
- **D-21 (new)** — Vercel cron was removed, so `/api/cron/tick` has no caller: T-15min departure
  reminders and the 6h auto-close of abandoned `started` trips do not run. Confirmed this session
  that trip **start** notifications are unaffected — `POST /api/trips/:id/start` writes the
  notification rows and pushes them inline. Options costed for the developer: Supabase `pg_cron` +
  `pg_net` (free, inside the existing service list) or an external pinger.

## Gates Now Green
- G1 (`pnpm verify`): typecheck, lint, 93/93 tests (7 new for the share message).
- G5 (core loop e2e): green again after the D-18 repair — and now joined by a second spec covering
  the share link's access rules end to end.

## Shipped (D-18 kudos decline, D-19 scoring rework)
- **D-18** (`370c60d`) — the kudos prompt had no "no thanks" path, so a rider who didn't want to
  give kudos could never clear it off a closed trip. Decline is now *recorded*
  (`trip_rider.kudos_declined_at`, migration `0006`) rather than dismissed client-side, so it stays
  cleared on every device. Rate card rebuilt as the sketch's 💚 toggle ("Give kudos" / "Kudos given
  ✓") with the submit switching between "Skip & close" and "Send kudos 💚".
  Chose trip_rider over a `kudos.declined` flag deliberately: every `kudos` row drives a
  points_ledger insert, so a declined row there would look like a kudos to anything counting them.
- **D-19** (`25de1ee`) — scoring rework, developer picked all three options from costed choices:
  pooling escalates per seat (`pool_weight + (n-1)·pool_step`, defaults 3/5/7 — a 3-rider trip goes
  19 → 25); a kudos is worth `kudos_weight × confirmed riders` (so 2 → 6 on a full car); a no-show
  costs the *rider* −10, worse than the −5 late cancellation. Migration `0007` adds
  `group.pool_step` and `group.no_show_penalty` and widens the ledger kind constraint.
  **Forward-only** — the ledger is append-only, so existing scores stand and nothing is recomputed.
- Both migrations applied to the live project with authorization. Types regenerated, then
  re-patched by hand to keep the CHECK-constraint literal unions the generator can't infer.
- Verified live, not just unit-tested: a 3-rider close wrote 10+3+5+7=25; a kudos on it wrote 6
  with reason "Received kudos (3 riders pooled)"; an unconfirmed rider was charged −10 on their own
  profile, not the driver's.

## In Progress
- Nothing mid-flight.

## Next
- **`CLAUDE.md` §4 is now stale** and is immutable to the agent — the developer needs to replace
  `10·driven + 3·pooled + 2·kudos` with `10·drive + pool 3+2/seat + 2·kudos×riders; no-show −10`.
- Open question raised with the developer, not yet answered: three solo trips still out-earn one
  full car (39 vs 25) because three trips means three `drive` awards. If a full car should win,
  `drive_weight` has to fall or pooling escalate harder.

## Blocked On
- **D-03** — Maps, deferred until the app shows real traction (paid API).
- **D-17** — the `comment` notification type renders in the bell but nothing can create one.
- Scheduled cron execution is deferred to Phase 10 until the Vercel project is moved to a paid
  plan; `vercel.json` currently has no active cron schedule, while `/api/cron/tick` remains available
  for CRON_SECRET-gated manual verification.

## Gates Now Green
- G1 (`pnpm verify`): green — typecheck, lint, 86/86 tests (points engine now 16, up from 11).
- G4 (points engine correctness): escalation, kudos scaling, no-show and the late-leave window are
  all pure functions with boundary tests; tests written before the implementation.
- G8 (API docs): close and kudos routes both carry a "Scoring (D-19)" line; the decline route is
  documented in the same commit that added it.

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
