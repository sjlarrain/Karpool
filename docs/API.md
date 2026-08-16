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

## Planned surface

Trips, kudos, points, notifications, admin console, and push endpoints land in later phases per
`02_IMPLEMENTATION_PLAN.md` §5 — documented here as each phase's routes are built.
