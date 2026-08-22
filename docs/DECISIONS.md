# Open Decisions Register

Seeded from `00_DEV_ENVIRONMENT_SETUP.md` §9 — this should have shipped at the end of session 1 but
did not. Backfilled at the start of session 2 before any Phase 0 work.

Each decision needs a one-line answer **from the developer**. A recommendation is not a decision —
work only proceeds on a recommendation where explicitly marked "applied" below, and only when the
alternative is effectively irreversible-neutral (a formatting/tooling choice already reflected in
committed code, not a product or data-model judgment call).

| ID | Decision | Recommendation | Status |
|---|---|---|---|
| D-01 | App framework on Vercel | Next.js 15 App Router + TypeScript | **Applied** — `package.json` deps confirm Next 15 + TS; scaffold completed session 2 |
| D-02 | Styling approach | Hand-written CSS + tokens ported from the sketch; no Tailwind | **Applied** — `package.json` has no Tailwind dependency (session 1); `src/styles/tokens.css` ported verbatim session 2 |
| D-03 | Google Maps topology (client-never-talks-to-Maps vs. Maps JS API — the infra plan contradicts itself) | Server-proxied Directions API + lightweight client renderer | Open (topology unanswered) — **Phase 6 is deferred indefinitely, not merely to the end of the build.** Originally moved after Phases 7–9 (developer, 2026-08-16); on **2026-08-19** the developer set a business precondition: build Maps only once the app shows *real traction*, because Maps is a paid API and they will not pay before there is usage. Do not start Phase 6, and do not re-propose it, until the developer says traction is there. |
| D-04 | Supabase auth topology (same client/server contradiction) | `@supabase/ssr` cookie sessions; all data access via Vercel API routes, anon key never used for browser reads | **Decided (2026-08-15)** — recommendation confirmed by developer: server-side only |
| D-05 | PWA service worker | Hand-written service worker + `manifest.webmanifest` | **Applied (2026-08-16, agent judgment call)** — the recorded recommendation was already the only reasonable engineering direction; built exactly as recommended (`public/sw.js`, `public/manifest.webmanifest`). Flagging per usual practice in case the developer wants to revisit. |
| D-06 | Package manager | pnpm | **Applied** — pnpm lockfile in use |
| D-07 | Admin scope — sketch shows group-level admin only; requirement 9 asks for platform-wide admin | Both, as separate roles (`platform_admin`, `group_admin`) | **Applied** — already embodied in `0001_init.sql` (`profile.platform_role`, `membership.group_role`, both `text check` enums with exactly this split); confirmed with developer 2026-08-17 while unblocking Phase 8 |
| D-08 | Cost split — static group setting or computed from distance? | Static per-group field in v1 | **Applied** — `group.cost_split_note` is a static per-group text field; `POST/PATCH /api/groups` already implement it this way |
| D-09 | Guest riders — shadow record or name-only string? | Name-only string on `trip_rider`, no account | **Applied** — `trip_rider.guest_name` is name-only, no profile; close flow inserts guest rows and credits their pooled points to the driver, verified end-to-end |
| D-10 | Late-cancellation penalty — fixed or per-group configurable? | Group-configurable, default −5 pts / 60 min | **Applied** — `group.late_window_minutes`/`late_penalty` drive `POST /api/trips/:id/leave`'s penalty, verified end-to-end |
| D-11 | Leaderboard weights (10/3/2) — global or per-group? | Per-group, defaults 10/3/2 | **Applied** — already implemented (`group.drive_weight`/`pool_weight`/`kudos_weight`, used since the Phase 4 close flow); the leaderboard now reads the same columns |
| D-12 | Leaderboard period — calendar month, rolling 30 days, or toggle? | Calendar month; ledger stays all-time | **Applied (2026-08-16, agent judgment call)** — `GET /api/groups/:id/leaderboard` filters to the current calendar month; `points_ledger` itself is never date-filtered/reset, matching "ledger stays all-time" |
| D-13 | Email domain restriction on group joining? | Not in v1 — group code only | **Decided (2026-08-15)** — recommendation confirmed by developer: group code only |
| D-14 | PII / audit-log data retention — in tension with the plan's own "audit_log is append-only, no delete path anywhere" non-negotiable | Keep every `audit_log` row indefinitely, no redaction/purge job | **Decided (2026-08-17)** — developer: not a priority for a small internal tool; the admin capability itself (fixing stuck trips, ledger mistakes) matters more than a retention policy right now. Revisit only if a real deletion/right-to-erasure need shows up later. |
| D-15 | (referenced by Phase 1 table, no entry recorded in the source doc) | — | **Dropped (2026-08-15)** — developer confirmed this is a documentation error in `02_IMPLEMENTATION_PLAN.md`, not a real decision; no longer blocks Phase 1 |
| D-16 | Trip `scheduled→started` window — "not before T−2h" per the implementation plan, unconfirmed | — | **Decided (2026-08-16)** — developer confirmed: fixed T−2h window |
| D-19 | Scoring rework — driving should scale with kudos and with how many people were pooled on a trip, and missing a pool should cost points | — | **Decided (2026-08-19)** — developer chose, from three costed options each: **(1)** pooling escalates per seat (`pool_weight + (n-1)·pool_step`, defaults 3/5/7 rather than flat 3); **(2)** a kudos is worth `kudos_weight × confirmed riders`, so rating rewards pooling not just driving; **(3)** a no-show costs the rider **−10**, deliberately worse than the −5 late cancellation, because a no-show wastes the seat entirely. All four numbers are per-group columns (migration `0007`). **Forward-only** — `points_ledger` is append-only, so existing scores are untouched and no history is recomputed. Supersedes the `10·driven + 3·pooled + 2·kudos` line in `CLAUDE.md` §4, which the developer needs to update by hand (that file is immutable to the agent). |
| D-18 | Kudos prompt has no "no thanks" path — the sketch's rate overlay has a 💚 toggle and submits either way; the built version only offers "Send kudos", so a rider who doesn't want to give kudos can never clear the prompt off a closed trip | Record the decline (a `kudos.declined` flag or a dismissed-at column) rather than hiding it client-side, so the prompt stays cleared across devices — but this is a product call, not an engineering one | **Decided (2026-08-19)** — developer: "that way after he has cleared the trip they can discard if they don't want to give kudos." Built as recommended: `trip_rider.kudos_declined_at` (migration `0006`), `POST /api/trips/:id/kudos/decline`, and the sketch's 💚 toggle whose submit reads "Send kudos" or "Skip & close". Applied and verified end-to-end. |
| D-17 | Sketch shows a `comment` notification type with no comment UI | Logged as a gap, not built as a feature, per `02_IMPLEMENTATION_PLAN.md` §7 | Open — no UI to build until answered |
| D-20 | Ride share link — what a shared trip URL exposes, and whether it grants access. Trips have no URL today (trip detail is client state), and a WhatsApp-shared link leaves the group by design | Teaser preview for non-members (route, day, time, seats left, driver first name — no pickup addresses, no rider names); actually joining the ride still requires sign-in **and** group membership via the existing `/j/CODE` code flow, so the 6-char code stays the access gate | Open (raised 2026-08-22, developer did not pick) — blocks the share button. The share sheet itself is not the question: `navigator.share()` + clipboard fallback already ships in `GroupScreen.tsx` for the group invite and would be reused verbatim |
| D-21 | Scheduler replacement — Vercel Cron was removed (free tier won't run a 5-minute schedule), so `/api/cron/tick` has no caller: **T-15min departure reminders and the 6h auto-close of abandoned `started` trips no longer run** | Supabase `pg_cron` + `pg_net` calling `/api/cron/tick` with the `CRON_SECRET` header — inside the existing service list, free tier, no new vendor. Alternative is an external pinger (cron-job.org / GitHub Actions), which adds a service the infrastructure plan doesn't name | Open (raised 2026-08-22, developer did not pick) — supersedes the earlier "deferred to Phase 10 pending a paid Vercel plan" note, since neither option needs a paid plan |

## Notes

- D-01, D-02, D-06, D-08, D-09, D-10 are marked "Applied" because they're already embodied in
  committed code (the dependency set; `group.cost_split_note`; `trip_rider.guest_name`;
  `group.late_window_minutes`/`late_penalty`), not open judgment calls — this is recording reality,
  not proceeding on an assumption.
- D-15 had no corresponding row in `00_DEV_ENVIRONMENT_SETUP.md` §9 even though
  `02_IMPLEMENTATION_PLAN.md` cited it as blocking Phase 1 alongside D-04 and D-13. Confirmed with
  the developer as a documentation error and dropped.
- Phase 0 (design tokens + component primitives) depended only on D-02, applied session 2. Phase 1
  (Supabase schema, RLS, auth) depended on D-04, D-13, D-15 — all now resolved, so Phase 1 work
  proceeds. Phases 2+ still stop at their listed open decisions until answered here.
- Build order deviates from `02_IMPLEMENTATION_PLAN.md` §2 as of 2026-08-16: Phase 6 (Maps) moves
  to the end, after Phase 9, per the developer. That file is immutable to the agent (proposed edits
  go here instead, per `CLAUDE.md`), so the phase table there still shows the original order — this
  note is the actual sequencing to follow.
- No Vercel deployment exists yet. Env vars that only make sense once one does (a live
  `NEXT_PUBLIC_APP_URL`, `CRON_SECRET` for a deployed cron endpoint, VAPID keys tied to a real
  push origin) are expected to stay placeholder/blank in `.env.local` for now — `src/env.ts`
  should only hard-require what local dev actually needs today (Supabase connection details),
  not deploy-time values. **Superseded 2026-08-16:** the developer populated `SUPABASE_ACCESS_TOKEN`,
  `SUPABASE_DB_PASSWORD`, and (already present) `VAPID_SUBJECT`/`NEXT_PUBLIC_VAPID_PUBLIC_KEY`/
  `VAPID_PRIVATE_KEY`/`CRON_SECRET`, and the Phase 1 schema is now genuinely live on the project (see
  below) — `src/env.ts` requires the VAPID/cron vars now that Phase 5 code actually reads them.
- **2026-08-16, discovered mid-session:** `0001_init.sql` (the entire Phase 1 schema) had never
  actually been applied to the live Supabase project — Docker was unavailable for local Postgres all
  session, and there was no CLI auth to push to the remote either, so every prior "Phase 1 done"
  claim was code-complete but not database-real. Fixed by linking the CLI with a developer-supplied
  access token + DB password and running `supabase db push` for real; `0002_join_trip.sql` and
  `0003_notification_reminder_type.sql` (Phase 4/5) went out the same way. `src/types/database.ts`
  is now generated from the real live schema (`pnpm db:types:linked`), not hand-written.
- **`VAPID_SUBJECT` in `.env.local` is not a valid `mailto:`/`https:` value** — `web-push` requires
  one of those two schemes and rejects anything else (confirmed live: a push send throws
  `Vapid subject is not an https: or mailto: URL`). Doesn't block anything that doesn't actually
  send a push (fixed a related bug this session — VAPID config is now lazy, not module-load-time —
  so this no longer crashes unrelated routes), but it does mean no push will actually deliver until
  the developer sets it to a real `mailto:you@yourdomain.com` or `https://yoursite/contact` value.
- **G6 (push verified on a real device) is not satisfiable in this agent's environment** — no
  physical device, and the headless browser pane's `Notification.permission` defaults to `"denied"`
  with no way to grant it (confirmed live). Manifest, service worker registration, subscribe/
  unsubscribe routes, and the cron reminder/auto-close logic are all verified live against the real
  database; actual push delivery to a device is not. This needs a real phone/browser test before G6
  can be claimed.
