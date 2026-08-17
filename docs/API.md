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
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `404 not_found` (not a member), `500 trip_create_failed`
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
- **Errors**: `401 unauthenticated`, `404 not_found`, `409 is_driver`, `409 wrong_status` (not scheduled), `409 already_joined`, `409 full`
- **Side effects**: inserts a `trip_rider` row (`state: "joined"`). No ledger writes on join — pooled points are awarded on close.

### `POST /api/trips/:id/leave`
Drop a seat you're holding.

- **Auth**: required, caller must hold an active seat on the trip
- **Request**: none
- **Response**: `{ tripRider, latePenalty: number | null }`
- **Errors**: `401 unauthenticated`, `404 not_found` (trip missing or caller isn't riding it), `409 wrong_status` (trip already closed/cancelled), `500 leave_failed`
- **Side effects**: updates the `trip_rider` row (`state: "left"`, `left_at`). If the leave falls inside the group's configured cancellation window (`group.late_window_minutes`, default 60 — from `windowMinutes` before departure through any time after), inserts a `late_leave` `points_ledger` entry (`group.late_penalty`, default -5) for the leaving rider.

## Planned surface

Kudos, notifications (delivery), admin console, and push endpoints land in later phases per
`02_IMPLEMENTATION_PLAN.md` §5 — documented here as each phase's routes are built.
