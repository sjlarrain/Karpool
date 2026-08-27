# Worklog

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
