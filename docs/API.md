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
- **Request**: `{ email: string, password: string (min 8), displayName: string (1-80 chars), groupCode?: string (≤16 chars) }`
- **Response**: `{ user: { id, email } | null, needsEmailConfirmation: boolean }`
- **Errors**: `400 invalid_request` (zod issues). Supabase auth failures are classified by
  `src/domain/authError.ts` rather than flattened into one status, and every one of them answers
  `{ error, message, detail }` — `message` is the copy the form shows, `detail` is Supabase's own
  wording, kept for debugging:
  - `429 email_send_rate_limited` — the confirmation email was refused by the mail provider's hourly
    cap. **Project-wide, not per user:** Supabase's built-in mailer allows 2 messages an hour for the
    whole project, so one signup blocks everyone else until custom SMTP is configured (`README.md` →
    Deploying to Vercel, step 5).
  - `502 email_not_authorized` — the mailer refused the recipient (the built-in sender only delivers
    to the Supabase project's team members).
  - `502 email_delivery_failed` — the send failed upstream for any other reason.
  - `403 signups_disabled` — new signups are switched off on the Supabase project.
  - `409 email_taken` — the email already has an account.
  - `400 email_invalid` / `400 weak_password` — genuinely the submitted form's fault.
  - `400 signup_failed` — anything unrecognised, carrying Supabase's message unchanged.
- **Side effects**: creates `auth.users` row; `handle_new_user()` trigger creates the matching `profile` row. No ledger/audit writes.
- **Email confirmation**: sets `emailRedirectTo` to `<origin>/auth/callback?next=…` so the confirmation link returns a signed-in session instead of dropping the visitor back on `/`. `groupCode`, when it is a valid 6-char code, sets `next=/j/CODE` and is also stashed in `user_metadata.pending_group_code` as a fallback; an invalid code is ignored rather than failing the signup. `<origin>` is the request's own origin when it is trusted (the configured `NEXT_PUBLIC_APP_URL` host, localhost, or a `*.vercel.app` preview), else `NEXT_PUBLIC_APP_URL` — see `src/domain/authRedirect.ts`.

### `GET /auth/callback`
The destination of the confirmation link in the signup email. Not under `/api` — Supabase redirects a
browser here, and the response is a redirect, not JSON.

- **Auth**: none (this is what establishes the session)
- **Request**: query params — `code` (PKCE, the default `{{ .ConfirmationURL }}` template) **or** `token_hash` + `type` (the `{{ .TokenHash }}` template); optional `next` (in-app path); Supabase's own `error`/`error_code` when the link already failed on its side
- **Response**: `307` redirect — to `next` on success (`/app` when absent, or `/j/CODE` from `user_metadata.pending_group_code`), else to `/?auth=link_expired` or `/?auth=link_invalid`, which the auth screen renders as an explanation
- **Note**: both invite carriers (`?next=` and `user_metadata.pending_group_code`) are read *only* here, so both are lost together if the confirmation link never reaches this route — which is exactly what happens when the Supabase project's Site URL / redirect allow-list does not include the deployed origin: Supabase refuses the requested `emailRedirectTo` and sends the visitor to the Site URL instead. `src/lib/api/redeemPendingInvite.ts` closes that hole by redeeming the stored code from the *pages* as well (`/` and `/app`, whenever an authenticated visitor has no membership), so a shared invite survives a misconfigured redirect. It clears the code once redeemed, or once the group it names no longer exists.
- **Errors**: never a status code — every failure is a redirect carrying `?auth=…`
- **Side effects**: exchanges the token for a session and sets the Supabase session cookie. No ledger/audit writes.
- **Security**: `next` is sanitised by `safeNextPath` — absolute URLs, protocol-relative paths, backslash variants and control characters all fall back to `/app`, so the parameter can't be used as an open redirect.

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
- **Request**: any non-empty subset of `{ name: string (1-80), originLabel: string (1-80), destLabel: string (1-80), costSplitNote: string (max 200) | null, parkingUrlOut: string (https, max 500) | null, parkingUrlBack: string (https, max 500) | null }`
- **Response**: `{ group }`
- **Errors**: `401 unauthenticated`, `404 not_found` (not a member), `403 forbidden` (member but not admin), `400 invalid_request`, `500 update_failed`
- **Side effects**: updates the `group` row. No ledger/audit writes.
- **Notes (D-54)**: `parkingUrlOut`/`parkingUrlBack` are where the driver pays for parking at each end of the commute, both optional — a group that pays at one end only fills in one. **`https://` is required and enforced twice**: by zod here and by a CHECK constraint on the column, because this is the only outbound link the app renders and an admin writes it for their colleagues to follow. Passing `null` clears a link. The group's own screen is the only caller.

## Pickup places

### `GET /api/groups/:id/pickup-places`
List a group's pickup places, sorted by `sort_order`.

- **Auth**: required (relies on RLS to scope results to the caller's groups)
- **Request**: none
- **Response**: `{ pickupPlaces: PickupPlace[] }`
- **Errors**: `401 unauthenticated`, `500 lookup_failed`
- **Side effects**: none

### `POST /api/groups/:id/pickup-places`
Add a pickup place or a stop. `group_admin` only — this is what keeps both lists manager-managed
(D-29).

- **Auth**: required, caller must be `group_admin` of `:id`
- **Request**: `{ label: string (1-80), address: string (1-160), typicalTime?: string (max 20), sortOrder?: number (int, >= 0), kind?: "pickup" | "stop" (default "pickup"), icon?: "gym" | "pool" | "run" | "sport" | "shop" | "coffee" | "school" | "medical" }`
- **Response**: `201 { pickupPlace }`
- **Errors**: `401 unauthenticated`, `404 not_found` (not a member), `403 forbidden` (not admin), `400 invalid_request`, `500 create_failed`
- **Side effects**: inserts a `pickup_place` row. No ledger/audit writes.
- **Notes**: `icon` is required for `kind: "stop"` and rejected for `kind: "pickup"` — mirrored by a
  CHECK in migration `0012`. A stop with no icon has no sign to render, which is the whole point of
  a stop. The two kinds never mix: pickup dropdowns (member pickup point, rider pickup) filter to
  `pickup`, and the trip form's stop pickers filter to `stop`.

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

## Guest riders (D-55)

The people who ride without an account. A guest used to be free text typed at close (D-09), so the
same colleague riding twice was two unrelated strings and nothing accumulated. A guest is now a row
on a per-group roster: seats point at it, its rides add up, and a group admin linking it to a member
makes **every seat it has ever held** count for that member — history included, not only forward.

Deliberately **not** a `profile` row: `profile.id` is a foreign key to `auth.users`, so a ghost
profile would mean minting fake accounts that appear in the admin Users tab, count as members and
can be sent notifications. The merge is therefore one `UPDATE` on one column, which is also what
makes it reversible.

`points_ledger` is never touched by a merge. Riders earn nothing (D-49), so a merge moves a *count*
— which is also how it sidesteps `check (points <> 0)`.

### `GET /api/groups/:id/guests`
The roster, with each guest's ride count and who they are linked to.

- **Auth**: required, caller must be a member of the group
- **Request**: none
- **Response**: `{ guests: { id, displayName, initials, color, rides: number, claimedBy: { profileId, name } | null, claimedAt: string | null }[], canManage: boolean, members: { profileId, name, initials, color }[] }`
- **Errors**: `401 unauthenticated`, `404 not_found` (not a member), `500 guest_lookup_failed`
- **Side effects**: none
- **Notes**: `rides` counts confirmed seats on **closed** trips — the same definition of `pooled` the leaderboard uses, so the number does not change meaning when it moves onto a member's line. `members` is the admin's link picker and is empty unless `canManage`; `initials`/`color` are derived (`initialsFor`/`avatarColorFor`), not stored.

### `POST /api/groups/:id/guests`
Add someone to the roster. `group_admin` only — the same rule D-29 set for the other admin-managed
list ("manager-managed and fixed — tags can be overpopulated"). Drivers pick from it, never add.

- **Auth**: required, `group_role: "group_admin"`
- **Request**: `{ displayName: string (1-80) }`
- **Response**: `{ guest }` (`201`)
- **Errors**: `401`, `404 not_found`, `403 forbidden`, `400 invalid_request`, `409 already_exists`, `500 create_failed`
- **Side effects**: inserts a `group_guest` row; writes an `audit_log` row (`group_guest_added`).
- **Notes**: `409 already_exists` is the unique index on `(group_id, lower(trim(display_name)))` — the constraint that makes the roster an identity rather than a list of strings.

### `DELETE /api/groups/:id/guests/:guestId`
Remove a guest. `group_admin` only, and refused while they hold **any** seat.

- **Auth**: required, `group_role: "group_admin"`
- **Response**: `{ ok: true }`
- **Errors**: `401`, `404 not_found`, `403 forbidden`, `409 has_rides`, `500 seat_lookup_failed`, `500 delete_failed`
- **Side effects**: deletes the `group_guest` row; writes an `audit_log` row (`group_guest_deleted`).
- **Notes**: the column is `on delete set null`, so the database would orphan the seats into plain named guests rather than refuse — the safe failure mode, not the intended one. Deleting is for a name typed in error; a guest with history gets linked, not removed.

### `POST /api/groups/:id/guests/:guestId/claim`
**The merge.** Link a guest to the member who turns out to be that person. `group_admin` only.

- **Auth**: required, `group_role: "group_admin"`
- **Request**: `{ profileId: uuid }` — must be a member of this group
- **Response**: `{ guest }`
- **Errors**: `401`, `404 not_found`, `403 forbidden`, `400 invalid_request`, `400 not_a_member`, `409 already_claimed`, `500 claim_failed`
- **Side effects**: sets `claimed_by_profile_id`, `claimed_at`, `claimed_by_admin_id`; writes an `audit_log` row (`group_guest_claimed`). Every seat the guest holds immediately counts for the member on the leaderboard and the YOU tab — **no rows are rewritten**, both routes resolve a seat through this column.
- **Notes**: the update is a compare-and-swap on `claimed_by_profile_id is null`, so two admins linking the same guest to two different members at once cannot silently overwrite each other. Two roster entries may point at the **same** member on purpose ("Maria", "Maria G" — the mess this table exists to clean up); each seat is still counted once.

### `DELETE /api/groups/:id/guests/:guestId/claim`
Undo a link. The rides go back to the guest and off the member's line.

- **Auth**: required, `group_role: "group_admin"`
- **Response**: `{ ok: true }`
- **Errors**: `401`, `404 not_found`, `403 forbidden`, `409 not_claimed`, `500 unclaim_failed`
- **Side effects**: clears the three claim columns; writes an `audit_log` row (`group_guest_unclaimed`).

### `POST /api/trips/:id/guests`
The driver seats a roster guest. The guest twin of `POST /riders`.

- **Auth**: required, caller must be the trip's driver
- **Request**: `{ groupGuestId: uuid }`
- **Response**: `{ tripRider }` (`201`)
- **Errors**: `401`, `404 not_found`, `404 guest_not_found`, `403 not_driver`, `403 wrong_group`, `409 wrong_status`, `409 already_joined`, `409 full`, `400 invalid_request`
- **Side effects**: calls `add_trip_guest()` (migration `0022`), which inserts a `trip_rider` row (`state: "joined"`, `group_guest_id` set, `guest_name` copied, `added_by_profile_id` = caller) under the same `select … for update` capacity lock `add_trip_rider` uses; writes an `audit_log` row (`trip_guest_seated_by_driver`). **Notifies nobody** — a guest has no profile and no device, which is the one thing this does not share with `POST /riders`.
- **Notes**: honours D-24 rather than reversing it. The developer rejected free-text guests in the pre-trip flow in favour of "group members only, picked from a list"; this is that list, extended to people who have no account yet. The seat counts against capacity like any other.

### `DELETE /api/trips/:id/guests/:tripRiderId`
The driver frees a seat they gave a roster guest.

- **Auth**: required, caller must be the trip's driver
- **Response**: `{ ok: true }`
- **Errors**: `401`, `404 not_found`, `403 not_driver`, `409 wrong_status`, `500 seat_lookup_failed`, `500 remove_failed`
- **Side effects**: sets the seat to `state: "left"` with `left_at`; writes an `audit_log` row (`trip_guest_removed_by_driver`). No ledger writes.
- **Notes**: separate from `DELETE /riders/:riderId` because that route notifies the person whose seat was taken back. Marks `left` rather than deleting, so a guest's history stays what they actually rode — a confirmed seat on a closed trip — and never a seat booked and undone.

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

Lifecycle transitions are enforced by the pure state machine in `src/domain/tripMachine.ts`
(exhaustively tested — see `tripMachine.test.ts`), not re-implemented in each route. **Since D-61
(2026-09-19) there are only two** — `scheduled→closed` (the SCHEDULER, once `depart_at` has passed)
and `scheduled→cancelled` (driver only, before departure). Every other transition is rejected, and
`started` is a historical status no trip can enter any more.

**D-61, the whole lifecycle in one paragraph.** Nobody starts or ends a ride. `/api/cron/tick`
settles every trip whose departure has passed: each booked seat becomes `confirmed`, the driver is
paid `drive_weight` + the seat bonus, and a round trip's return leg is materialised (it then settles
at its own departure). Riders and the driver get one push 15 minutes before each leg, and the driver
gets a "pay for parking" push 30 minutes after departure when the group has a link for that leg.
Until the **end of the departure day, in the driver's time zone** (`src/domain/tripSettle.ts`,
`src/lib/api/rosterWindow.ts`), the driver can still fix the list: report a no-show, seat someone
who rode without booking, or free a seat they had added. After that the ride is history.

**Times and time zones.** Every instant on the wire is an absolute ISO timestamp (`depart_at`,
`return_at`, `departAt`) — `timestamptz` in the database, never a wall-clock string. A `TripView`
also carries *rendered* strings for the UI (`time`, `returnTime`, `dayLabel`), and those are
rendered **in the reader's time zone**, not the server's. The zone reaches the server in the
`carpool_tz` cookie, written by `<TimeZoneSync/>` (`src/app/TimeZoneSync.tsx`) from the browser's
own IANA zone; if it is absent the server falls back to Vercel's `x-vercel-ip-timezone` header and
then to UTC (`src/lib/time/viewerTimeZone.ts`). Anything that *compares* two trips must use the ISO
instant, never the rendered string — "7:45" sorts after "17:30" as text.

### `GET /api/trips?groupId=&scope=all|mine`
Trip feed for a group: all `scheduled`/`started` trips, plus every `closed`/`cancelled` trip that
departed within the last 30 days (`PAST_TRIPS_WINDOW_DAYS`), for the Carpools tab's Past section
(D-27). Each `TripView` carries `departed` (past its departure time — D-23) and `cancelledReason`
(`"not_started"` marks a trip the scheduler expired, which the UI renders as "Past", not
"Cancelled").

- **Auth**: required, caller must be a member of `groupId`
- **Request**: query params `groupId` (required), `scope` (`all` default, or `mine` — trips where the caller is driving or an active rider)
- **Response**: `{ trips: TripView[] }` (role/badge/day-label already derived for the caller, in the reader's zone — see the time-zone note above; each view also carries `departAt`, the ISO instant behind those strings; see `src/domain/types.ts`). Each carries `direction` and `outStop`/`backStop` — the D-29 stop on each leg, or `null`; the decorated form adds `stopNotices`, the same stops in travel order with their leg wording
- **Errors**: `401 unauthenticated`, `400 invalid_request` (missing groupId), `404 not_found` (not a member), `500 trip_lookup_failed` / `rider_lookup_failed` / `driver_lookup_failed`
- **Side effects**: none

### `POST /api/trips`
Driver publishes a trip. The group owns the route — trips never invent origin/destination, only
pick a direction along it.

- **Auth**: required, caller must be a member of `groupId`
- **Request**: `{ groupId: string (uuid), direction: "out" | "back" | "round", departAt: string (ISO date/time), returnAt?: string (ISO date/time, required iff direction is "round"), capacity: number (1-7), outStopId?: string (uuid) | null, backStopId?: string (uuid) | null }`
- **Response**: `201 { trip }`
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `400 unknown_stop`, `404 not_found` (not a member), `429 rate_limited` (10/hour per caller), `500 trip_create_failed`
- **Side effects**: inserts a `trip` row (`status: "scheduled"`, `driver_id` = caller). No ledger/audit writes.
- **Notes** (D-29): at most one stop per leg. `outStopId` is rejected for `direction: "back"` and
  `backStopId` for `direction: "out"` — a leg the trip doesn't travel can't carry a stop, enforced
  by zod here and by CHECK constraints in migration `0012`. Both ids must name a `pickup_place` in
  **this** group with `kind: "stop"`, or the route answers `400 unknown_stop`.
- **Notes** (D-47): `departAt` in the past, or a `returnAt` at or before `departAt`, is rejected
  as `400 invalid_request` — checked in `src/domain/tripSchedule.ts`, backed by CHECK constraints
  in migration `0023`.

### `GET /api/trips/:id`
Trip detail overlay: decorated summary plus the driver's pickup list in route order. RLS
(`is_member`) makes this 404 rather than 403 for a non-member.

- **Auth**: required, caller must be a member of the trip's group
- **Request**: none
- **Response**: `{ trip: DecoratedTrip, driverId, isDriver: boolean, parkingUrl: string | null, cancelledReason: string | null, seatsLeft: number, pickups: { id, name, initials?, color?, pickupLabel: string | null, stopOrder: number | null, isViewer: boolean, addedByDriver: boolean, groupGuestId: string | null }[], addableMembers: { id, name, initials, color }[], addableGuests: { id, name, initials, color }[], penaltyWaived: boolean, editable: { departAt, returnAt: string | null, capacity: number, direction, outStopId: string | null, backStopId: string | null, stops: TripStopView[] } | null }`
- **Errors**: `401 unauthenticated`, `404 not_found`, `500 trip_lookup_failed`, `500 rider_lookup_failed`
- **Side effects**: none
- **Notes**: `trip.stopNotices` (D-29) is the ride's stops in travel order, each with its `leg` (`out`/`back`) and the `when` wording the UI shows (`"in way"` for an outbound stop, `"back"` for a return one). Empty for a direct ride. `addableMembers` (D-24) is the passenger picker's list — group members not already on the trip. Empty unless the caller is the driver and the trip is `scheduled`/`started`. `pickups[].addedByDriver` marks a seat the driver booked for someone. `penaltyWaived` (D-38) is true when the caller's own seat carries `trip_rider.penalty_waived_at` — the driver changed the trip after they joined, so leaving costs them nothing and the UI says so instead of showing the usual late-cancellation warning. `editable` (D-38) is the edit form's starting values plus the group's stop list, non-null only when the caller is the driver **and** the trip is still `scheduled`; `direction` is included for the form's leg rules but is **not** editable. `parkingUrl` (D-54) is the group's parking link for the leg this trip travels (`back` gets `parking_url_back`, everything else `parking_url_out`), and is **null for anyone but the driver** — the gate is here rather than in the client, so a rider never receives the URL at all.

### `PATCH /api/trips/:id`
Edit a trip. Driver only, and live only — `scheduled` **or** `started`. D-56 (2026-09-07,
developer: "Always editable by the driver") opened this to a started trip: the plan is exactly what
changes once the driver is in the car. Closed and cancelled trips are history and stay shut.

- **Auth**: required, caller must be the trip's driver
- **Request**: any non-empty subset of `{ departAt: string (ISO), returnAt: string (ISO) | null, capacity: number (1-7), outStopId: string (uuid) | null, backStopId: string (uuid) | null }`
- **Response**: `{ trip, changed: TripEditField[], notifiedRiders: number }` — `changed` lists only the fields whose value actually moved (`departAt` / `returnAt` / `capacity` / `outStopId` / `backStopId`), so a form resaved untouched comes back `changed: []` with the trip unmodified.
- **Errors**: `401 unauthenticated`, `404 not_found`, `403 forbidden` (not the driver), `409 wrong_status` (closed or cancelled), `409 capacity_below_riders` (fewer seats than people already aboard), `400 invalid_request`, `400 unknown_stop`, `500 update_failed`, `500 waiver_failed`
- **Side effects**: updates the `trip` row. When a **material** field changed — the departure, the
  return, or either stop, as defined by `diffTripEdit` in `src/domain/tripEdit.ts` — it also
  (a) stamps `trip_rider.penalty_waived_at` on **every seat already aboard**, so those riders can
  leave with no late-cancellation charge (D-38), and (b) notifies them
  (`notification.type: "change"`). A rider who joined a direct ride needs to know it now detours,
  and a rider whose 07:45 became an 08:30 needs to know they can walk away. The waiver is written
  **before** the notification, so a rider acting on the push the instant it lands finds the free
  drop-out already in force. A capacity-only change notifies nobody and waives nothing — a seat
  added or taken back changes nothing for the people already in the car. No ledger/audit writes.
- **Notes** (D-29): pass `null` to clear a stop. The same leg rules as `POST` apply, checked against
  the trip's stored `direction`; stop ids are resolved through the caller's own session (RLS), so a
  place from another group reads as `400 unknown_stop`.
- **Notes** (D-47): only rejects on a field actually being set — a capacity-only or stop-only edit
  is still allowed on a trip whose `depart_at` has already passed (D-23's post-departure window),
  but setting `departAt` itself into the past, or a `returnAt` at or before the (possibly just-set)
  `departAt`, is `400 invalid_request`.
- **Notes** (D-38): `direction` is deliberately **not** editable — turning an outbound into a return
  is a different ride from the one people joined, not an edit of it. Times are compared as instants,
  not strings, so the client's `…Z` and Postgres's `…+00:00` spelling of the same moment do not read
  as a change. The seat floor is the number of **active riders**, not the number of confirmed ones:
  there is no rule for which rider would lose their seat, and this route does not invent one.

### `POST /api/trips/:id/cancel`
Driver only, `scheduled→cancelled`, and **only before departure** (D-61).

- **Auth**: required, caller must be the trip's driver
- **Request**: `{ reason?: string (max 200) }` — the system's own sentinels (`not_started`, `lifecycle_rollout`) are refused (`400 invalid_request`): a driver typing one would dress their own cancellation up as the system's.
- **Response**: `{ trip, notifiedRiders: number }`
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `404 not_found`, `403 not_driver`, `409 wrong_status`, `409 departed` (D-61: a ride that has left happened — its list is fixed, it is not called off)
- **Side effects**: updates `trip.status` and `cancelled_reason`, and notifies every active rider
  (`notification.type: "change"`, title "Trip cancelled", carrying the driver's reason verbatim when
  they gave one) — D-38. A cancellation is the one trip event a rider cannot discover by looking, and
  they need the time to find another way in. **Nobody is charged**: the riders keep their seats on a
  dead trip rather than leaving them, and a cancelled trip pays and penalises no one. No ledger/audit
  writes.

### `POST /api/trips/:id/no-show`
D-61. The driver reports a rider who booked a seat and didn't ride.

- **Auth**: required, caller must be the trip's driver
- **Request**: `{ tripRiderId: string (uuid) }`
- **Response**: `{ riderPoints: number, driverPoints: number }` — the group's `no_show_penalty` (default **-5**) and `no_show_report_bonus` (default **+2**)
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `404 not_found` (trip missing, or that rider isn't confirmed on it), `403 not_driver`, `409 wrong_status`, `409 window_closed` (the departure day is over), `409 not_settled` (the scheduler hasn't counted the ride yet), `409 not_self_booked` (a seat the driver added, or a guest — free it instead), `409 already_rated` (the rider has given kudos, so they rode), `409 already_reported`, `500 ledger_write_failed`
- **Side effects**: flips the seat `confirmed → no_show` under a compare-and-swap (a double tap charges once); inserts **two** `points_ledger` rows in one statement — `no_show` for the rider and `no_show_report` for the driver — and hands the seat back if that insert fails; notifies the rider (`type: "change"`); writes an `audit_log` row (`trip_no_show_reported`). **The driver keeps the seat's pay**: they held the seat and drove, so no `drive_adjust` is written. Only a seat the rider booked themselves can be reported — a guest has no points to lose, and paying a driver to report a guest they seated themselves would be free points.

### `POST /api/trips/:id/join`
Join an open seat. Calls `join_trip()` (`supabase/migrations/0002_join_trip.sql`), a Postgres
function that locks the trip row (`select ... for update`) for the duration of the capacity check +
insert, so two riders racing for the last seat produce exactly one winner — verified against the
live database with concurrent requests on a 1-seat trip.

- **Auth**: required, caller must be a member of the trip's group and not its driver
- **Request**: `{ wantsReturn: boolean }` — **required, no default** (D-35 answer (C)). Joining a round trip asks outright whether the rider is coming back with the same driver; there is deliberately no opt-in/opt-out default, so a join that never asked the question is a `400` rather than a silent "not returning". Forced to `false` on a one-way trip, which has no return leg to declare for.
- **Response**: `201 { tripRider }`
- **Errors**: `401 unauthenticated`, `400 invalid_request` (missing `wantsReturn`), `404 not_found`, `429 rate_limited` (20/10min per caller), `409 is_driver`, `409 wrong_status` (not scheduled), `409 already_joined`, `409 full`, `409 departed` (D-23 — departure time has passed; only the driver can seat anyone after that)
- **Side effects**: inserts a `trip_rider` row (`state: "joined"`, `wants_return` as answered). No ledger writes on join, and none on close either: a rider earns no points at all (D-49). The seat itself is what the rider's `pooled` count is drawn from once the trip closes. The declaration does nothing until the outbound closes, at which point a `true` seats the rider on the generated return leg and a `false` is what frees that seat for everyone else — never before (D-35). **Notifies the driver** (`type: "join"`) + push, so a filling car is news the driver receives rather than has to go looking for (D-52). The notification fires **after** the seat is committed and can never fail the join — D-39 is the standing reason that order is not left to chance.

### `POST /api/trips/:id/leave`
Drop a seat you're holding.

- **Auth**: required, caller must hold an active seat on the trip
- **Request**: none
- **Response**: `{ tripRider, latePenalty: number | null, penaltyWaived: boolean }`
- **Errors**: `401 unauthenticated`, `404 not_found` (trip missing or caller isn't riding it), `409 wrong_status` (trip already settled/cancelled), `409 departed` (D-61 — see below), `500 seat_lookup_failed`, `500 leave_failed`
- **Side effects**: updates the `trip_rider` row (`state: "left"`, `left_at`). A failed seat lookup is `500 seat_lookup_failed`, never `404` — telling a rider who holds a seat that they don't would leave them on a trip they believe they left. If the leave falls inside the group's configured cancellation window (`group.late_window_minutes`, default 60 — from `windowMinutes` before departure through any time after), inserts a `late_leave` `points_ledger` entry (`group.late_penalty`, default -5) for the leaving rider. **Exception (D-24):** a seat the driver added (`trip_rider.added_by_profile_id` set) is never penalised — the rider never booked it. **Exception (D-38):** a seat whose trip changed under the rider (`trip_rider.penalty_waived_at` set by `PATCH /api/trips/:id`) is never penalised either, at any distance from departure — the window exists to stop people dropping out at the last minute on a plan that never moved, and the plan moved. The response's `penaltyWaived` says which rule applied. **D-61: a seat cannot be given back once the trip has departed** — every booked seat counts as ridden then, so leaving afterwards would be a no-show by another name, and a cheaper one. The driver reports it instead. **Notifies the driver** (`type: "leave"`) + push — a freed seat is one the driver can offer to someone else (D-52) — fired last, after the seat and any penalty are written.

### `POST /api/trips/:id/riders`
Driver seats a group member who asked for the ride in person (D-24). Calls `add_trip_rider()`
(`supabase/migrations/0026`, replacing 0010's), which takes the same row lock as `join_trip()` — a
driver adding someone while a rider self-joins is exactly that race. **D-61: also works after the
ride**, until the end of the departure day, for someone who rode without booking; the seat then goes
in as `confirmed` and the driver's award is re-priced. The end-of-day bound needs the driver's time
zone, so the SQL accepts any settled trip and the route enforces the window
(`src/lib/api/rosterWindow.ts`).

- **Auth**: required, caller must be the trip's driver
- **Request**: `{ profileId: string (uuid) }`
- **Response**: `201 { tripRider, pointsAdjusted: number, awardError: string | null }` — `pointsAdjusted` is the seat's bonus when the trip has already settled. `0` while it is still scheduled, when nothing has been paid yet.
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `404 not_found`, `403 not_driver`, `409 is_driver`, `409 wrong_status` (cancelled), `409 window_closed` (the departure day is over), `409 not_member` (not in the trip's group), `409 already_joined`, `409 full`
- **Side effects**: inserts a `trip_rider` row (`joined` before departure, `confirmed` after, `added_by_profile_id` = caller); appends a `drive_adjust` `points_ledger` row on a settled trip; notifies the added member (`type: "change"`) + push; writes an `audit_log` row (`trip_rider_added_by_driver`).

### `DELETE /api/trips/:id/riders/:riderId`
Driver takes back a seat they booked for someone (D-24). Limited to seats the driver added — a
rider who joined of their own accord gives up their seat through `POST /leave`, and a driver must
not be able to bump them.

- **Auth**: required, caller must be the trip's driver
- **Request**: none
- **Response**: `{ tripRider, pointsAdjusted: number, awardError: string | null }`
- **Errors**: `401 unauthenticated`, `404 not_found` (trip missing, or that rider isn't on it), `403 not_driver`, `403 not_added_by_driver`, `409 wrong_status`, `409 window_closed`, `500 remove_failed`
- **Side effects**: updates the `trip_rider` row (`state: "left"`, `left_at`); appends a `drive_adjust` `points_ledger` row on a settled trip, taking that seat's bonus back off the driver; notifies the removed member + push; writes an `audit_log` row (`trip_rider_removed_by_driver`). The rider is never charged — a driver undoing their own action isn't a late cancellation. **D-61**: also available after the ride, until the end of that day — the counterpart of a no-show report for a seat the rider never asked for. Nobody is charged; the driver is simply no longer paid for it.

## Trip chat (D-57)

A message thread per trip, for the ride itself. The developer, 2026-09-07: *"Can we built a in app
chat to tell important messages to the people that is being pool. Example: I wait you here. I am
here, etc."* Scope was asked and answered — **one thread per trip**, not a group-wide room: both
examples are about one ride at one moment, and on a morning when three cars leave together a shared
room cannot say *whose*.

**Who is in a thread**: the driver, plus anyone holding a seat (`trip_rider.state` of `joined` or
`confirmed`). Not the group. A colleague who is not in the car has no business posting to the people
who are, and the group tab is where group-wide things belong. Guests (D-09/D-55) hold seats but no
account, so they neither post nor get notified — there is nobody to attribute a message to.

Both rules live as pure predicates in `src/domain/tripChat.ts` (`canReadTrip`, `canPostToTrip`) and
are applied identically on the read and the write. `trip_message`'s RLS policy is bounded to the
caller's group, which is defence in depth (D-04); the narrowing to *actually on this ride* happens in
the route, because a policy does not express it cheaply.

**A non-participant gets `404`, not `403`** — on both verbs. Telling someone they may not read a
thread discloses that there is a thread worth reading.

### `GET /api/trips/:id/messages`
The thread, oldest first.

- **Auth**: required, caller must be the trip's driver or hold an active seat on it
- **Request**: none
- **Response**: `{ messages: ChatMessage[], canPost: boolean }` where `ChatMessage` is `{ id, authorId, authorName, initials, color, body, createdAt, mine }`. Author identity is resolved server-side with the same `initials`/`avatar_color` fallbacks the trip cards use, so one person is never two different colours across two screens. `canPost` is the client's cue to render a composer or a read-only footer; the route enforces it regardless. **D-61**: it stays true on a settled trip until the end of its departure day — the ride is under way just as the status reads `closed` — and the thread is readable history after that.
- **Errors**: `401 unauthenticated`, `404 not_found` (trip missing, in another group, or the caller is not on it), `500 message_lookup_failed`
- **Notes**: capped at 200 messages. A failed query is `500`, never an empty thread — telling someone their messages are gone when the query merely failed is the failure mode `GET /api/trips/:id`'s rider lookup was fixed for on 2026-08-30.
- **Side effects**: none.

### `POST /api/trips/:id/messages`
Say something to the people on this ride.

- **Auth**: required, caller must be the trip's driver or hold an active seat on it
- **Request**: `{ body: string (1-500 chars) }`
- **Response**: `201 { message: { id, authorId, body, createdAt }, notified: number, notifyError: string | null }`
- **Errors**: `401 unauthenticated`, `400 invalid_request` (missing, too long, or whitespace-only — zod bounds the raw string, `normalizeMessageBody` bounds what is actually stored, so 500 spaces is a `400` rather than a blank row), `404 not_found`, `409 wrong_status` (the trip is closed or cancelled — the thread stays **readable**, but nothing said now can help anyone catch a ride that is over), `429 rate_limited` (30 per 10 minutes per caller), `500 send_failed`
- **Side effects**: inserts a `trip_message` row; inserts a `comment`-type `notification` row for **everyone else on the trip** and pushes to their devices. The push body is the message itself, truncated to 120 characters — a notification that says "you have a new message" makes you unlock the phone to discover it said "here", which defeats the entire feature. Notification failures are reported in `notifyError`, never thrown: the message exists and is on screen for anyone with the thread open (D-39's standing rule — the thing being announced must not depend on the announcement).
- **Notes**: the client offers six one-tap quick messages (`QUICK_MESSAGES` in `src/domain/tripChat.ts`, seeded from the developer's own examples). They are plain text posted through this same route with the same validation — a chip is a shortcut, not a second kind of message.
- **Notes (delivery)**: there is no realtime channel in this stack (the infrastructure lineament is Supabase + Web Push and nothing else), so the open thread polls this route's `GET` every 12 seconds and only while the chat overlay is mounted. Push is what reaches a phone that is not looking.

## Kudos & scores

### `POST /api/trips/:id/kudos`
Binary kudos (you give it or you don't — calling this endpoint at all *is* the "give" action;
there's no body flag for declining). Only a confirmed registered rider on a `closed` trip can give
kudos, once per trip. Awards the driver `group.kudos_weight` points.

- **Auth**: required, caller must be a confirmed rider (`trip_rider.state = "confirmed"`) on this trip
- **Request**: `{ comment?: string (max 500) }`
- **Response**: `201 { kudos }`
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `404 not_found`, `409 wrong_status` (not closed), `409 is_driver`, `403 not_confirmed_rider`, `429 rate_limited` (20/hour per caller), `409 already_given` (**including a kudos already given on the other leg of the same round trip** — D-35 answer (B): one per rider per *ride*, and the `unique (trip_id, from_profile_id)` constraint alone cannot see across two rows), `500 kudos_failed`, `500 kudos_award_failed` (the `kudos` row was written but the driver's ledger entry could not be — the kudos row is deleted again and the rider keeps their one rating; if that rollback also fails the message says so, and an admin has to place the points by hand)
- **Scoring (D-19, amended by D-35)**: the award is `group.kudos_weight × the ride's confirmed rider count` (guests included), so a kudos on a full car is worth more than one on a solo pickup. On a round trip that count is the **fuller of the two legs**, not the leg being rated — a rider rates the leg where their ride ended, usually the emptier return, and scaling by that alone would pay the driver less for having carried more people. Floors at one rider.
- **Side effects**: inserts a `kudos` row; inserts a `kind: "kudos"` `points_ledger` entry for the driver. The two are **all-or-nothing**: if the ledger entry cannot be written the `kudos` row is deleted again and the call answers `500 kudos_award_failed`. It used to answer `201` and drop the points silently, which was unrecoverable — the unique constraint meant a second attempt returned `409 already_given` for ever, and no other route writes a kudos award.

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
**All-time** ranking, weighted per the group's own `drive_weight`/`pool_weight`/`kudos_weight`
(D-11). `driven` is a **row count** of the member's `drive` entries. `pooled` is **not** a ledger
figure since D-49: riding earns nothing, so it is counted from the member's `confirmed` `trip_rider`
seats on closed trips. It means rides taken as a passenger, not passengers carried (D-42's
correction, kept). Every group member appears, even with no points yet — and a member who has only
ever ridden appears with their `pooled` count and a score of `0`.

**D-12 was reversed on 2026-09-01** (developer: "Points are all time"). This view used to reset every
calendar month. There is now **no date filter anywhere** in it: every `points_ledger` row the group
has ever written is counted, and `pooled` counts seats on every closed trip, so both halves of a
member's line always cover the same rides. That window was the sole source of two production bugs
the same day — a round trip whose legs closed either side of midnight on the 1st was split across
two leaderboards, and each attempt to pick the "right" month for it was a choice between two wrong
answers. Removing the window removed the question.

- **Auth**: required, caller must be a member of `:id`
- **Request**: none
- **Response**: `{ entries: RankedRow[] (profileId, name, initials, color, registered: boolean, driven, pooled, kudos, points, rank, medal: string | null), formula: string, viewerProfileId: string }`
- **Notes (D-55)**: a seat counts for its rider **or** for whoever a group admin has linked its guest to, so linking a guest moves their whole history onto that member at once. Unclaimed guests with at least one ride appear as their own entries with `registered: false`, `points: 0` and their ride count as `pooled` — greyed and marked "not registered yet" on Ranks. For those rows `profileId` holds the `group_guest` id, a different table, so it can never collide with a real profile id. A **claimed** guest never appears as its own row: its rides are on the member's line, and listing both would show one ride twice.
- **Errors**: `401 unauthenticated`, `404 not_found`
- **Side effects**: none

### `GET /api/me/points?groupId=<uuid>`
The caller's own all-time totals **for one group** (developer, 2026-09-01: "My tab must be explicit
for the group that I am in"). Since D-12 was reversed the same day, this and
`GET /api/groups/:id/leaderboard` cover the identical period *and* the identical group, so a
member's YOU tab and their own row on the Ranks tab now agree by construction — verified live across
all six members of the test group.

**`groupId` is required, with no default.** It previously summed every group the caller belonged to
while the YOU tab rendered those totals directly beneath one group's name and member count, so a
member of two groups read one group's heading over both groups' numbers. Defaulting to "all groups"
would leave that wrong answer reachable by omission, so a caller that forgets gets a `400` — the
same rule D-49 applied to `aggregateLedger`'s rider count and D-35(C) to `wantsReturn`.

`pooled` is the one figure here that is not a ledger total: since D-49 riding earns nothing, so it
counts the caller's `confirmed` seats on closed trips in this group instead (all-time, like the
rest). `stopsThisMonth` **is** still month-scoped and deliberately so — D-29 designed it as a
resettable streak, not a score — and is now also group-scoped like everything beside it.

- **Auth**: required; caller must be a member of `groupId` (a non-member gets `404`, the same shape
  as the leaderboard route, so neither reveals that a group exists)
- **Request**: `?groupId=<uuid>` (required)
- **Response**: `{ driven, pooled, kudos, points, stopsThisMonth, groupId }` — `groupId` is echoed
  back so a caller can tell which group a cached response describes
- **Errors**: `401 unauthenticated`, `400 invalid_request` (missing or non-uuid `groupId`), `404 not_found`
- **Side effects**: none
- **Notes**: `stopsThisMonth` (D-29) counts `closed` trips this calendar month, in this group, that
  passed through a stop and that the caller drove or rode (`state: "confirmed"`). Unlike the four
  totals above it is month-scoped, and it is **not** a ledger figure — stops score no points, so
  this number can never move the leaderboard.

## Notifications

The in-app bell. Rows are written by the trip lifecycle routes and the cron tick (see
`src/lib/notify/tripNotify.ts`); these two routes are the read side.

### `GET /api/notifications`
The caller's own notification feed, newest first.

- **Auth**: required
- **Request**: `?limit=` (int, 1–50, default 30)
- **Response**: `{ notifications: Array<{ id, type: "start"|"rate"|"change"|"comment"|"tip"|"reminder"|"close_reminder"|"join"|"leave"|"parking", title, body: string|null, tripId: string|null, read: boolean, createdAt: string }>, unreadCount: number }`
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
Called every 5 minutes by the `carpool-tick` pg_cron job in Supabase (D-21, migration `0008`), which
posts here through `pg_net` with the `CRON_SECRET` header; `GET` is kept for triggering a tick by
hand with curl. **Since D-61 this route IS the trip lifecycle.** Three jobs per tick, in order:

1. **Departure reminders** — any `scheduled` trip departing within `DEPARTURE_REMINDER_LEAD_MINUTES`
   (15) gets a `reminder`-type notification + push to its driver and active riders, deduped against
   an existing reminder row carrying that trip's id. The window also reaches
   `DEPARTURE_REMINDER_GRACE_MINUTES` (5) *behind* now, so a trip whose departure slipped past
   between two ticks still gets a slightly late reminder instead of none at all. A round trip's
   return leg is a real trip by the time it is due — job 2 created it at the outbound's departure —
   so "15 minutes before the return" needs no job of its own.
2. **Settle departed trips (D-61)** — every `scheduled` trip whose `depart_at` has passed is settled
   through `src/lib/api/settleTrip.ts`, oldest first: a compare-and-swap claim `scheduled→closed`,
   every `joined` seat marked `confirmed`, a round trip's return leg materialised through
   `generate_back_trip()`, and the driver paid `drive_weight` + the seat bonus. Nobody is notified —
   the reminder went out 15 minutes earlier and kudos lives on the card. Audit row
   `cron_settle_trip`. A lost race answers `wrong_status` and is **not** a failure; anything else is
   recorded in `failures`, which is what D-60's silent retry loop lacked. There is deliberately no
   lower bound on the query: a scheduler that was down for a day still pays yesterday's rides.
3. **Parking reminders (D-61)** — `PARKING_REMINDER_AFTER_MINUTES` (30) after a settled leg
   departed, and for `PARKING_REMINDER_GRACE_MINUTES` (60) after that, its **driver only** gets a
   `parking`-type notification + push. Sent only when the group has a parking link for that leg's
   direction (D-54) — a leg with nothing to pay stays quiet. Deduped per trip.

Retired by D-61: the close reminder, D-35 mechanic (ii)'s T-2h return-leg close, the 6h auto-close,
and D-23's 24h expiry of trips nobody started.

- **Auth**: `Authorization: Bearer <CRON_SECRET>`. The scheduler reads both the URL and the secret from Supabase Vault (`carpool_tick_url`, `carpool_cron_secret`) at call time, so neither is in any tracked file; with either missing the job returns without calling anything.
- **Request**: none
- **Response**: `{ failures: string[], remindersSent: number, reminderFailures: number, settled: number, parkingRemindersSent: number }`. Each trip is processed in isolation: a throw is recorded in `failures` as `<job>/<tripId>: <message>` and the sweep moves on, because the jobs run in one request and an unhandled throw used to abort every job after it — permanently, since the next tick meets the same data. `reminderFailures` is how a broken notification path becomes visible: `notifyProfiles` returns its insert error rather than discarding it, so a tick that could not write its rows reports a number instead of looking idle.
- **Errors**: `401 unauthorized`

## Feedback

### `POST /api/feedback`
In-app feedback from the Profile tab (D-25). Stored in Postgres and read from the admin console —
deliberately not emailed, since the project has no custom SMTP (D-22), and feedback that depends on
mail delivery is feedback that silently doesn't arrive.

- **Auth**: required
- **Request**: `{ category: "bug" | "idea" | "praise" | "other", message: string (1-2000), groupId?: string (uuid) }`
- **Response**: `201 { feedback: { id, created_at } }`
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `429 rate_limited` (10/hour per caller), `500 feedback_failed`
- **Side effects**: inserts a `feedback` row. The sender comes from the session, never from the body; `groupId` is verified against the caller's own memberships and dropped if it isn't one of theirs. The request's `user-agent` is stored — a bug report without it is usually unactionable.

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

> **Removed by D-61 (2026-09-19):** `POST /api/admin/trips/:id/force-close` and
> `POST /api/admin/trips/:id/force-start`. They existed to rescue a trip whose driver never tapped
> Start or Close; the scheduler now settles every trip at its departure, so there is nothing left to
> rescue. The admin Trips tab is read-only.

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

### `GET /api/admin/feedback?category=&limit=&offset=`
Everything submitted through the feedback form, newest first, with sender and group names resolved.
Read-only: feedback is a record of what someone said, so there is no edit or delete path — the same
reasoning as the audit log (D-14).

- **Auth**: platform admin
- **Request**: query params `category` (`bug`/`idea`/`praise`/`other`; anything else is ignored), `limit` (1-200, default 50), `offset`
- **Response**: `{ entries: { id, category, message, userAgent, createdAt, senderName, groupName }[], total, limit, offset }`
- **Errors**: `401 unauthenticated`, `403 forbidden`, `500 lookup_failed`
- **Side effects**: none. A deleted account's feedback survives (`profile_id` goes null) and reads as "Deleted account".

### `GET /api/admin/health`
Push delivery stats (subscription/failure/dead counts), the scheduler's own pulse, recent cron auto-closes, and a placeholder for Maps health (`status: "not_applicable"` — Phase 6 isn't built yet).

`push.channel` reports the **sending** side, where the counts report the receiving side. It is the D-21 lesson applied to push: a healthy-looking set of subscriptions with `configured: false` is the exact state in which every notification is written to the bell and none of them ever reaches a phone, and "nobody got a notification" and "the VAPID subject is not a `mailto:` URL" look identical from the outside. `error` carries `web-push`'s own message. `normalizedFrom` is non-null when `VAPID_SUBJECT` arrived without a scheme and was completed to one (`src/domain/vapidSubject.ts`) — it names the value as configured, so the repair is announced rather than silent. A config that quietly fixes itself is a config nobody ever corrects at the source.

`scheduler` reads the `carpool-tick` pg_cron job through `public.carpool_cron_status()` (migration `0009`). It exists because an empty `recentCronAutoCloses` means either "nothing was abandoned" or "the scheduler is dead", and for weeks it silently meant the second (D-21). `scheduled: false` = the job was never created; `stale: true` = no successful run in the last 20 minutes (four missed ticks).

- **Auth**: `platform_admin`
- **Request**: none
- **Response**: `{ push: { totalSubscriptions, failingSubscriptions, deadSubscriptions, channel: { configured, error, normalizedFrom } }, scheduler: { scheduled, active, schedule, lastRunAt, lastStatus, stale }, recentCronAutoCloses, maps: { status, message } }`
- **Errors**: `401 unauthenticated`, `403 forbidden`
- **Side effects**: none.

## Link entry points (pages, not API routes)

Two URLs are meant to be pasted into a chat app, so they are documented here alongside the routes:
they are the only surfaces where an unauthenticated stranger can arrive holding an identifier.

### `GET /j/:code` — group invite link

Auth: none required to view. Side effects: **joins the group** (idempotent `membership` insert) when
the visitor is already signed in, then redirects to `/app?g=<groupId>`. A signed-out visitor sees the
group's name and route with the auth form below it, the code prefilled; signing in re-runs the page
and completes the join. Invalid code format or unknown code → a dead-end page, no group data.

### `GET /t/:id` — ride share link (D-20)

Auth: **required, and the viewer must be a member of the ride's group.** The link carries no
information of its own:

| Viewer | Result |
|---|---|
| Malformed id | "That ride link isn't valid" — no lookup performed |
| Signed out | "Sign in to see this ride" + the auth form; nothing about the ride or its group |
| Signed in, not a member | "This ride isn't available to you" — the `trip` select runs under the session client, so RLS (`is_member`) returns no row and the page cannot distinguish "no such ride" from "not yours" |
| Signed in, member | `redirect` to `/app?g=<groupId>&trip=<tripId>`, which opens the trip detail overlay |

No side effects, no writes. Unlike `/j/:code` it never grants access to anything — a forwarded ride
link is useless to anyone the group hasn't already admitted by code.

## Planned surface

In-app notification reads (the bell/sheet UI) and Google Maps routing land in later phases per
`02_IMPLEMENTATION_PLAN.md` §5 — documented here as each phase's routes are built.
