# API

Every route follows `CLAUDE.md` §3.5: authenticate → authorize → validate (zod) → act → typed
response. All authenticated reads use the session client (`@/lib/supabase/server`), so Postgres RLS
(`is_member()`) bounds every `SELECT` as defense-in-depth. All writes use the service-role client
(`@/lib/supabase/admin`) per D-04 — authorization is enforced in route code, not RLS, because no
table grants `authenticated` an INSERT/UPDATE/DELETE policy. Request/response shapes are derived
from the zod schemas in each route file, so keep this doc and the code in sync — update both in the
same commit.

None of these routes write to `points_ledger` or `audit_log` yet; that starts in Phase 4 (points
engine) and Phase 8 (admin console).

## Auth

### `POST /api/auth/signup`
Create an account. Step 1 of the sketch's two-step signup — the group-code step is a separate call
to `POST /api/groups/join` once the account exists.

- **Auth**: none
- **Request**: `{ email: string, password: string (min 8), displayName: string (1-80 chars) }`
- **Response**: `{ user: { id, email } | null, needsEmailConfirmation: boolean }`
- **Errors**: `400 invalid_request` (zod issues), `400 signup_failed` (Supabase auth error, e.g. email already registered)
- **Side effects**: creates `auth.users` row; `handle_new_user()` trigger creates the matching `profile` row. No ledger/audit writes.

### `POST /api/auth/signin`
Sign in with email + password.

- **Auth**: none
- **Request**: `{ email: string, password: string }`
- **Response**: `{ user: { id, email } }`
- **Errors**: `400 invalid_request`, `401 signin_failed`
- **Side effects**: sets the Supabase session cookie via `@supabase/ssr`. No ledger/audit writes.

### `POST /api/auth/signout`
Clear the current session.

- **Auth**: session cookie (no-op if absent)
- **Request**: none
- **Response**: `{ ok: true }`
- **Errors**: none
- **Side effects**: clears the session cookie. No ledger/audit writes.

### `GET /api/me`
Current user, profile, and group memberships — drives the root route's auth/locked/redirect gate.

- **Auth**: required
- **Request**: none
- **Response**: `{ user: { id, email }, profile: { id, display_name, initials, avatar_color, platform_role }, groups: { id, name, code, role }[], hasGroup: boolean }`
- **Errors**: `401 unauthenticated`, `500 profile_missing`, `500 membership_lookup_failed`, `500 group_lookup_failed`
- **Side effects**: none

## Groups

### `GET /api/groups`
Groups the caller belongs to.

- **Auth**: required
- **Request**: none
- **Response**: `{ groups: { id, name, origin_label, dest_label, code, role }[] }`
- **Errors**: `401 unauthenticated`, `500 membership_lookup_failed`, `500 group_lookup_failed`
- **Side effects**: none

### `POST /api/groups`
Create a group. Caller becomes `group_admin`. Generates a unique 6-char uppercase code
(`generateGroupCode()`, retried up to 10 times against a collision check).

- **Auth**: required
- **Request**: `{ name: string (1-80), originLabel: string (1-80), destLabel: string (1-80), costSplitNote?: string (max 200) }` (D-08: static per-group text)
- **Response**: `201 { group, role: "group_admin" }`
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `500 group_create_failed`, `500 membership_create_failed`
- **Side effects**: inserts `group` + `membership` rows. No ledger/audit writes.

### `POST /api/groups/join`
Join a group by code.

- **Auth**: required
- **Request**: `{ code: string }`
- **Response**: `{ group, role, alreadyMember: boolean }` (`201` on new join, `200` if already a member)
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `400 invalid_code` (malformed format), `404 invalid_code` (no group with that code), `500 group_lookup_failed`, `500 join_failed`
- **Side effects**: inserts a `membership` row (`member` role) unless already a member. No ledger/audit writes.

### `GET /api/groups/:id`
Group profile screen: route, admin name, cost split, code, pickup places, invite link.

- **Auth**: required, must be a member (RLS `is_member()` makes a non-member's row invisible, so this 404s rather than 403s — never leaks whether a group exists to an outsider)
- **Request**: none
- **Response**: `{ group, memberCount: number, adminName: string | null, pickupPlaces: PickupPlace[], inviteLink: string }`
- **Errors**: `401 unauthenticated`, `404 not_found`, `500 group_lookup_failed`
- **Side effects**: none

### `PATCH /api/groups/:id`
Update group fields. `group_admin` only. Does not touch the code (regeneration is Phase 8's admin console).

- **Auth**: required, caller's membership on this group must have `group_role: "group_admin"`
- **Request**: any non-empty subset of `{ name: string (1-80), originLabel: string (1-80), destLabel: string (1-80), costSplitNote: string (max 200) | null }`
- **Response**: `{ group }`
- **Errors**: `401 unauthenticated`, `404 not_found` (not a member), `403 forbidden` (member but not admin), `400 invalid_request`, `500 update_failed`
- **Side effects**: updates the `group` row. No ledger/audit writes.

## Pickup places

### `GET /api/groups/:id/pickup-places`
List a group's pickup places, sorted by `sort_order`.

- **Auth**: required (relies on RLS to scope results to the caller's groups)
- **Request**: none
- **Response**: `{ pickupPlaces: PickupPlace[] }`
- **Errors**: `401 unauthenticated`, `500 lookup_failed`
- **Side effects**: none

### `POST /api/groups/:id/pickup-places`
Add a pickup place. `group_admin` only.

- **Auth**: required, caller must be `group_admin` of `:id`
- **Request**: `{ label: string (1-80), address: string (1-160), typicalTime?: string (max 20), sortOrder?: number (int, >= 0) }`
- **Response**: `201 { pickupPlace }`
- **Errors**: `401 unauthenticated`, `404 not_found` (not a member), `403 forbidden` (not admin), `400 invalid_request`, `500 create_failed`
- **Side effects**: inserts a `pickup_place` row. No ledger/audit writes.

### `PATCH /api/pickup-places/:id`
Update a pickup place. `group_admin` (of the place's group) only.

- **Auth**: required, caller must be `group_admin` of the pickup place's group
- **Request**: any non-empty subset of `{ label: string (1-80), address: string (1-160), typicalTime: string (max 20) | null, sortOrder: number (int, >= 0) }`
- **Response**: `{ pickupPlace }`
- **Errors**: `401 unauthenticated`, `404 not_found`, `403 forbidden`, `400 invalid_request`, `500 update_failed`
- **Side effects**: updates the `pickup_place` row. No ledger/audit writes.

### `DELETE /api/pickup-places/:id`
Remove a pickup place. `group_admin` (of the place's group) only.

- **Auth**: required, caller must be `group_admin` of the pickup place's group
- **Request**: none
- **Response**: `{ ok: true }`
- **Errors**: `401 unauthenticated`, `404 not_found`, `403 forbidden`, `500 delete_failed`
- **Side effects**: deletes the `pickup_place` row. No ledger/audit writes.

## Memberships

### `PATCH /api/memberships/:id`
Update a membership. A member can set their own `pickupPlaceId`; changing `groupRole` requires the
caller to already be `group_admin` of that membership's group.

- **Auth**: required. `pickupPlaceId` changes: caller must own the membership. `groupRole` changes: caller must be `group_admin` of the membership's group.
- **Request**: any non-empty subset of `{ pickupPlaceId: string (uuid) | null, groupRole: "member" | "group_admin" }`
- **Response**: `{ membership }`
- **Errors**: `401 unauthenticated`, `404 not_found`, `403 forbidden` (`"You can only set your own pickup place."` / `"Only a group admin can change roles."`), `400 invalid_request`, `500 update_failed`
- **Side effects**: updates the `membership` row. No ledger/audit writes.

## Trips

Lifecycle transitions (`start`/`cancel`/`close`) are enforced by the pure state machine in
`src/domain/tripMachine.ts` (exhaustively tested — see `tripMachine.test.ts`), not re-implemented in
each route: `scheduled→started` (driver only, not before T-2h per D-16), `started→closed` (driver
only), `scheduled→cancelled` (driver only). Every other transition is rejected.

### `GET /api/trips?groupId=&scope=all|mine`
Live trip feed for a group — `scheduled`/`started` trips only; closed/cancelled trips don't appear
here.

- **Auth**: required, caller must be a member of `groupId`
- **Request**: query params `groupId` (required), `scope` (`all` default, or `mine` — trips where the caller is driving or an active rider)
- **Response**: `{ trips: TripView[] }` (role/badge/day-label already derived for the caller; see `src/domain/types.ts`)
- **Errors**: `401 unauthenticated`, `400 invalid_request` (missing groupId), `404 not_found` (not a member), `500 trip_lookup_failed` / `rider_lookup_failed` / `driver_lookup_failed`
- **Side effects**: none

### `POST /api/trips`
Driver publishes a trip. The group owns the route — trips never invent origin/destination, only
pick a direction along it.

- **Auth**: required, caller must be a member of `groupId`
- **Request**: `{ groupId: string (uuid), direction: "out" | "back" | "round", departAt: string (ISO date/time), returnAt?: string (ISO date/time, required iff direction is "round"), capacity: number (1-7) }`
- **Response**: `201 { trip }`
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `404 not_found` (not a member), `429 rate_limited` (10/hour per caller), `500 trip_create_failed`
- **Side effects**: inserts a `trip` row (`status: "scheduled"`, `driver_id` = caller). No ledger/audit writes.

### `GET /api/trips/:id`
Trip detail overlay: decorated summary plus the driver's pickup list in route order. RLS
(`is_member`) makes this 404 rather than 403 for a non-member.

- **Auth**: required, caller must be a member of the trip's group
- **Request**: none
- **Response**: `{ trip: DecoratedTrip, driverId, isDriver: boolean, cancelledReason: string | null, pickups: { id, name, initials?, color?, pickupLabel: string | null, stopOrder: number | null, isViewer: boolean }[] }`
- **Errors**: `401 unauthenticated`, `404 not_found`
- **Side effects**: none

### `PATCH /api/trips/:id`
Edit a trip. Driver only, and only while `status: "scheduled"` — a started or closed trip's plan is
fixed.

- **Auth**: required, caller must be the trip's driver
- **Request**: any non-empty subset of `{ departAt: string (ISO), returnAt: string (ISO) | null, capacity: number (1-7) }`
- **Response**: `{ trip }`
- **Errors**: `401 unauthenticated`, `404 not_found`, `403 forbidden` (not the driver), `409 wrong_status` (not scheduled), `400 invalid_request`, `500 update_failed`
- **Side effects**: updates the `trip` row. No ledger/audit writes.

### `POST /api/trips/:id/start`
Driver only, `scheduled→started`, not before T-2h (D-16).

- **Auth**: required, caller must be the trip's driver
- **Request**: none
- **Response**: `{ trip }`
- **Errors**: `401 unauthenticated`, `404 not_found`, `403 not_driver`, `409 wrong_status`, `409 too_early`
- **Side effects**: updates `trip.status` and `started_at`. No ledger/audit writes; no `notification` rows yet (lands with Phase 5 push).

### `POST /api/trips/:id/cancel`
Driver only, `scheduled→cancelled`.

- **Auth**: required, caller must be the trip's driver
- **Request**: `{ reason?: string (max 200) }`
- **Response**: `{ trip }`
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `404 not_found`, `403 not_driver`, `409 wrong_status`
- **Side effects**: updates `trip.status` and `cancelled_reason`. No ledger/audit writes.

### `POST /api/trips/:id/close`
Driver only, `started→closed`. Confirms which currently-active registered riders actually rode
(everyone not listed becomes `no_show`), adds any guest riders, and awards points.

- **Auth**: required, caller must be the trip's driver
- **Request**: `{ confirmedTripRiderIds?: string[] (uuid, trip_rider row ids — not profile ids — of active riders who rode; default []), guestNames?: string[] (1-80 chars each, max 20; default []) }`. Any id in `confirmedTripRiderIds` that isn't an active rider on this trip is silently ignored, not trusted.
- **Response**: `{ trip, confirmedCount: number, noShowCount: number, pointsAwarded: number }`
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `404 not_found`, `403 not_driver`, `409 wrong_status`, `500 confirm_failed` / `no_show_failed` / `guest_add_failed` / `ledger_write_failed` / `update_failed`
- **Side effects**: updates confirmed riders' `trip_rider.state` to `"confirmed"`, unconfirmed active riders to `"no_show"`; inserts a `trip_rider` row per guest (`state: "confirmed"`, `profile_id: null`); inserts `points_ledger` rows to the **driver** — one `drive` entry (`group.drive_weight`) plus one `pool` entry (`group.pool_weight`) per confirmed rider, registered or guest (guests have no profile to hold their own points, so their contribution always lands on the driver — matches the sketch's "guest riders still count toward your pooled score"); inserts a `rate`-type `notification` row for each confirmed *registered* rider; updates `trip.status` and `closed_at`.

### `POST /api/trips/:id/join`
Join an open seat. Calls `join_trip()` (`supabase/migrations/0002_join_trip.sql`), a Postgres
function that locks the trip row (`select ... for update`) for the duration of the capacity check +
insert, so two riders racing for the last seat produce exactly one winner — verified against the
live database with concurrent requests on a 1-seat trip.

- **Auth**: required, caller must be a member of the trip's group and not its driver
- **Request**: none
- **Response**: `201 { tripRider }`
- **Errors**: `401 unauthenticated`, `404 not_found`, `429 rate_limited` (20/10min per caller), `409 is_driver`, `409 wrong_status` (not scheduled), `409 already_joined`, `409 full`
- **Side effects**: inserts a `trip_rider` row (`state: "joined"`). No ledger writes on join — pooled points are awarded on close.

### `POST /api/trips/:id/leave`
Drop a seat you're holding.

- **Auth**: required, caller must hold an active seat on the trip
- **Request**: none
- **Response**: `{ tripRider, latePenalty: number | null }`
- **Errors**: `401 unauthenticated`, `404 not_found` (trip missing or caller isn't riding it), `409 wrong_status` (trip already closed/cancelled), `500 leave_failed`
- **Side effects**: updates the `trip_rider` row (`state: "left"`, `left_at`). If the leave falls inside the group's configured cancellation window (`group.late_window_minutes`, default 60 — from `windowMinutes` before departure through any time after), inserts a `late_leave` `points_ledger` entry (`group.late_penalty`, default -5) for the leaving rider.

## Kudos & scores

### `POST /api/trips/:id/kudos`
Binary kudos (you give it or you don't — calling this endpoint at all *is* the "give" action;
there's no body flag for declining). Only a confirmed registered rider on a `closed` trip can give
kudos, once per trip. Awards the driver `group.kudos_weight` points.

- **Auth**: required, caller must be a confirmed rider (`trip_rider.state = "confirmed"`) on this trip
- **Request**: `{ comment?: string (max 500) }`
- **Response**: `201 { kudos }`
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `404 not_found`, `409 wrong_status` (not closed), `409 is_driver`, `403 not_confirmed_rider`, `429 rate_limited` (20/hour per caller), `409 already_given`, `500 kudos_failed`
- **Side effects**: inserts a `kudos` row; inserts a `kind: "kudos"` `points_ledger` entry for the driver.

### `POST /api/trips/:id/kudos/decline`
The "no thanks" half of the kudos prompt (D-18). Records that the rider closed the prompt without
giving kudos, so it stays cleared on every device instead of reappearing on the next load.

- **Auth**: required. Caller must be a `confirmed` registered rider on the trip.
- **Request**: none
- **Response**: `{ declined: true }`
- **Errors**: `401 unauthenticated`, `404 not_found`, `409 wrong_status` (trip not closed), `409 is_driver`, `409 already_given` (already gave kudos — nothing to decline), `403 not_confirmed_rider`, `500 decline_failed`
- **Side effects**: sets `trip_rider.kudos_declined_at`. Deliberately writes **nothing** to `kudos` and
  **nothing** to `points_ledger` — a decline is the absence of kudos, not a kind of kudos.
  Idempotent: declining twice is still `200`.

### `GET /api/groups/:id/leaderboard`
Calendar-month ranking (D-12 — the ledger itself stays all-time; only this view's window resets
monthly), weighted per the group's own `drive_weight`/`pool_weight`/`kudos_weight` (D-11). Every
group member appears, even with zero points this month.

- **Auth**: required, caller must be a member of `:id`
- **Request**: none
- **Response**: `{ entries: RankedRow[] (profileId, name, initials, color, driven, pooled, kudos, points, rank, medal: string | null), formula: string, viewerProfileId: string }`
- **Errors**: `401 unauthenticated`, `404 not_found`
- **Side effects**: none

### `GET /api/me/points`
The caller's own lifetime totals — all-time, across every group they belong to (D-12: only the
group leaderboard view is month-scoped, the ledger itself never resets).

- **Auth**: required
- **Request**: none
- **Response**: `{ driven: number, pooled: number, kudos: number, points: number }`
- **Errors**: `401 unauthenticated`
- **Side effects**: none

## Notifications

The in-app bell. Rows are written by the trip lifecycle routes and the cron tick (see
`src/lib/notify/tripNotify.ts`); these two routes are the read side.

### `GET /api/notifications`
The caller's own notification feed, newest first.

- **Auth**: required
- **Request**: `?limit=` (int, 1–50, default 30)
- **Response**: `{ notifications: Array<{ id, type: "start"|"rate"|"change"|"comment"|"tip"|"reminder", title, body: string|null, tripId: string|null, read: boolean, createdAt: string }>, unreadCount: number }`
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `500 notifications_load_failed`
- **Side effects**: none

### `POST /api/notifications/read`
Mark notifications read, clearing the bell's unread dot. Opening the sheet calls this with no ids.

- **Auth**: required
- **Request**: `{ ids?: string[] (uuid, 1–50) }` — omit `ids` to mark every unread row read
- **Response**: `{ updated: number }`
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `500 notifications_update_failed`
- **Side effects**: sets `notification.read_at` on the caller's own rows. Ownership is enforced by
  RLS (`notification_own_update`, migration `0005`), not by the route — without that policy the
  update silently affects zero rows rather than erroring.

## Push

### `POST /api/push/subscribe`
Store a browser's `PushSubscription` (from `registration.pushManager.subscribe()`). Upserts on
`endpoint`, so re-subscribing (e.g. after a key rotation, or the same browser signing in as a
different user) updates the existing row instead of duplicating it.

- **Auth**: required
- **Request**: `{ endpoint: string (url), keys: { p256dh: string, auth: string } }` — a `PushSubscription.toJSON()` object
- **Response**: `201 { subscription }`
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `500 subscribe_failed`
- **Side effects**: upserts a `push_subscription` row (`profile_id` = caller, `user_agent` from the request header). No ledger/audit writes.

### `POST /api/push/unsubscribe`
Remove a browser's `PushSubscription`. Scoped to the caller's own subscriptions.

- **Auth**: required
- **Request**: `{ endpoint: string (url) }`
- **Response**: `{ ok: true }`
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `500 unsubscribe_failed`
- **Side effects**: deletes the matching `push_subscription` row, if any (idempotent — a missing row is still `{ ok: true }`).

## Cron

### `GET|POST /api/cron/tick`
Vercel Cron target (`vercel.json`, every 5 minutes — Vercel Cron always sends `GET`; `POST` is kept
for manual/local triggering with curl). Two jobs per tick: (1) departure reminders — any
`scheduled` trip departing within 15 minutes gets a `reminder`-type notification + push to its
driver and active riders, deduped by checking for an existing reminder notification carrying that
trip's id; (2) auto-close — any trip left `started` for 6+ hours is force-closed as a safety net
(never touches `points_ledger` — no driver confirmed who actually rode).

- **Auth**: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron's own convention when `CRON_SECRET` is set on the project)
- **Request**: none
- **Response**: `{ remindersSent: number, autoClosed: number }`
- **Errors**: `401 unauthorized`
- **Side effects**: inserts `notification` rows (`type: "reminder"`) + sends push; updates stale trips' `status`/`closed_at`; inserts an `audit_log` row per auto-close (`actor_profile_id: null` marks it as system-acted, `action: "cron_auto_close"`).

## Admin

Every route below re-checks `profile.platform_role === 'platform_admin'` server-side via
`authenticateAdmin()` (`src/lib/api/adminAuth.ts`) — a role claim from the client is never trusted.
A non-admin (including an unauthenticated caller) gets `403 forbidden` (G9). The first
`platform_admin` is set by `pnpm admin:bootstrap` (`scripts/bootstrap-admin.ts`), which promotes
whichever account matches `ADMIN_BOOTSTRAP_EMAIL`; idempotent, safe to re-run.

### `GET /api/admin/metrics`
Headline counts for the console's Overview tab: user/group/ledger-entry counts and trips by status.

- **Auth**: `platform_admin`
- **Request**: none
- **Response**: `{ userCount, groupCount, ledgerEntryCount, totalTrips, tripsByStatus: { scheduled, started, closed, cancelled } }`
- **Errors**: `401 unauthenticated`, `403 forbidden`
- **Side effects**: none (read-only, no audit row — not a privileged PII read).

### `GET /api/admin/users`
Platform-wide user list. `?search=` filters by display name (case-insensitive substring); `?limit=`/`?offset=` paginate (max 200/page).

- **Auth**: `platform_admin`
- **Request**: none (query params only)
- **Response**: `{ users: [{ id, display_name, initials, avatar_color, platform_role, created_at, last_seen_at, email }], total, limit, offset }`
- **Errors**: `401 unauthenticated`, `403 forbidden`, `500 lookup_failed`/`auth_lookup_failed`
- **Side effects**: none (read-only, no audit row — a list view isn't a per-user PII open).

### `GET /api/admin/users/:id`
One member's full detail: profile, email, memberships, trips driven/ridden, ledger history, kudos received.

- **Auth**: `platform_admin`
- **Request**: none
- **Response**: `{ profile, memberships, tripsDriven, tripsRidden, ledger, kudosReceived }`
- **Errors**: `401 unauthenticated`, `403 forbidden`, `404 not_found`, `500 lookup_failed`/`auth_lookup_failed`
- **Side effects**: **always** inserts an `audit_log` row (`action: "view_user_detail"`) — G10's "every privileged PII read writes an audit_log row."

### `PATCH /api/admin/users/:id/role`
Promote/demote a user's `platform_role`. An admin can't demote their own account (must be done by another admin).

- **Auth**: `platform_admin`
- **Request**: `{ role: "member" | "platform_admin" }`
- **Response**: `{ profile }`
- **Errors**: `401 unauthenticated`, `403 forbidden`, `400 invalid_request` (self-demote or bad body), `404 not_found`, `500 update_failed`
- **Side effects**: updates `profile.platform_role`; inserts an `audit_log` row (`action: "update_user_role"`, `before`/`after` capture the role change).

### `GET /api/admin/groups`
Every group with member count, trip count, code, and route.

- **Auth**: `platform_admin`
- **Request**: none
- **Response**: `{ groups: [{ id, name, code, origin_label, dest_label, created_at, created_by, memberCount, tripCount }] }`
- **Errors**: `401 unauthenticated`, `403 forbidden`, `500 lookup_failed`
- **Side effects**: none.

### `GET /api/admin/trips`
Cross-group trip explorer. `?status=scheduled|started|closed|cancelled` filters; `?limit=`/`?offset=` paginate.

- **Auth**: `platform_admin`
- **Request**: none (query params only)
- **Response**: `{ trips: [...], total, limit, offset }`
- **Errors**: `401 unauthenticated`, `403 forbidden`, `500 lookup_failed`
- **Side effects**: none.

### `POST /api/admin/trips/:id/force-close`
Safety-net close for a stuck trip. Never touches `points_ledger` — same rule as the cron auto-close, since nobody confirmed who actually rode.

- **Auth**: `platform_admin`
- **Request**: `{ reason: string (1-500 chars, required) }`
- **Response**: `{ trip }`
- **Errors**: `401 unauthenticated`, `403 forbidden`, `400 invalid_request`, `404 not_found`, `409 wrong_status` (already closed/cancelled), `500 update_failed`
- **Side effects**: sets `trip.status = "closed"`/`closed_at`; inserts an `audit_log` row (`action: "force_close_trip"`, `after` includes the required reason).

### `GET /api/admin/ledger`
Full `points_ledger` browse. `?profileId=`/`?groupId=` filter; `?limit=`/`?offset=` paginate.

- **Auth**: `platform_admin`
- **Request**: none (query params only)
- **Response**: `{ entries: [...], total, limit, offset }`
- **Errors**: `401 unauthenticated`, `403 forbidden`, `500 lookup_failed`
- **Side effects**: none.

### `POST /api/admin/ledger/adjust`
Manual, signed ledger correction. `points_ledger` is append-only (CLAUDE.md §3.5) — this always INSERTs a new `admin_adjust` row, never edits or removes history.

- **Auth**: `platform_admin`
- **Request**: `{ profileId: uuid, groupId: uuid, points: int (nonzero), reason: string (1-500 chars, required) }`
- **Response**: `201 { entry }`
- **Errors**: `401 unauthenticated`, `403 forbidden`, `400 invalid_request`, `404 not_found`, `500 ledger_write_failed`
- **Side effects**: inserts a `points_ledger` row (`kind: "admin_adjust"`); inserts an `audit_log` row (`action: "admin_adjust_ledger"`).

### `GET /api/admin/audit-log`
The audit trail itself — read-only; `audit_log` has no UPDATE/DELETE path anywhere, including for admins (D-14). `?action=`/`?entityType=`/`?actorProfileId=` filter; `?limit=`/`?offset=` paginate.

- **Auth**: `platform_admin`
- **Request**: none (query params only)
- **Response**: `{ entries: [...], total, limit, offset }`
- **Errors**: `401 unauthenticated`, `403 forbidden`, `500 lookup_failed`
- **Side effects**: none.

### `GET /api/admin/health`
Push delivery stats (subscription/failure/dead counts), recent cron auto-closes, and a placeholder for Maps health (`status: "not_applicable"` — Phase 6 isn't built yet).

- **Auth**: `platform_admin`
- **Request**: none
- **Response**: `{ push: { totalSubscriptions, failingSubscriptions, deadSubscriptions }, recentCronAutoCloses, maps: { status, message } }`
- **Errors**: `401 unauthenticated`, `403 forbidden`
- **Side effects**: none.

## Planned surface

In-app notification reads (the bell/sheet UI) and Google Maps routing land in later phases per
`02_IMPLEMENTATION_PLAN.md` §5 — documented here as each phase's routes are built.
