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

### `GET /api/trips/:id`
Trip detail overlay: decorated summary plus the driver's pickup list in route order. RLS
(`is_member`) makes this 404 rather than 403 for a non-member.

- **Auth**: required, caller must be a member of the trip's group
- **Request**: none
- **Response**: `{ trip: DecoratedTrip, driverId, isDriver: boolean, cancelledReason: string | null, seatsLeft: number, pickups: { id, name, initials?, color?, pickupLabel: string | null, stopOrder: number | null, isViewer: boolean, addedByDriver: boolean }[], addableMembers: { id, name, initials, color }[], penaltyWaived: boolean, editable: { departAt, returnAt: string | null, capacity: number, direction, outStopId: string | null, backStopId: string | null, stops: TripStopView[] } | null }`
- **Errors**: `401 unauthenticated`, `404 not_found`, `500 trip_lookup_failed`, `500 rider_lookup_failed`
- **Side effects**: none
- **Notes**: `trip.stopNotices` (D-29) is the ride's stops in travel order, each with its `leg` (`out`/`back`) and the `when` wording the UI shows (`"in way"` for an outbound stop, `"back"` for a return one). Empty for a direct ride. `addableMembers` (D-24) is the passenger picker's list — group members not already on the trip. Empty unless the caller is the driver and the trip is `scheduled`/`started`. `pickups[].addedByDriver` marks a seat the driver booked for someone. `penaltyWaived` (D-38) is true when the caller's own seat carries `trip_rider.penalty_waived_at` — the driver changed the trip after they joined, so leaving costs them nothing and the UI says so instead of showing the usual late-cancellation warning. `editable` (D-38) is the edit form's starting values plus the group's stop list, non-null only when the caller is the driver **and** the trip is still `scheduled`; `direction` is included for the form's leg rules but is **not** editable.

### `PATCH /api/trips/:id`
Edit a trip. Driver only, and only while `status: "scheduled"` — a started or closed trip's plan is
fixed.

- **Auth**: required, caller must be the trip's driver
- **Request**: any non-empty subset of `{ departAt: string (ISO), returnAt: string (ISO) | null, capacity: number (1-7), outStopId: string (uuid) | null, backStopId: string (uuid) | null }`
- **Response**: `{ trip, changed: TripEditField[], notifiedRiders: number }` — `changed` lists only the fields whose value actually moved (`departAt` / `returnAt` / `capacity` / `outStopId` / `backStopId`), so a form resaved untouched comes back `changed: []` with the trip unmodified.
- **Errors**: `401 unauthenticated`, `404 not_found`, `403 forbidden` (not the driver), `409 wrong_status` (not scheduled), `409 capacity_below_riders` (fewer seats than people already aboard), `400 invalid_request`, `400 unknown_stop`, `500 update_failed`, `500 waiver_failed`
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
- **Notes** (D-38): `direction` is deliberately **not** editable — turning an outbound into a return
  is a different ride from the one people joined, not an edit of it. Times are compared as instants,
  not strings, so the client's `…Z` and Postgres's `…+00:00` spelling of the same moment do not read
  as a change. The seat floor is the number of **active riders**, not the number of confirmed ones:
  there is no rule for which rider would lose their seat, and this route does not invent one.

### `POST /api/trips/:id/start`
Driver only, `scheduled→started`, not before T-2h (D-16).

- **Auth**: required, caller must be the trip's driver
- **Request**: none
- **Response**: `{ trip, notifiedRiders: number, pushDelivery: { sent: number, configError: string | null } }`. The delivery counts are reported rather than thrown: the trip has started and stays started whether or not any phone lit up, so a broken push channel must not fail the request — but it must not be invisible either. `pushDelivery.configError` is what a bad `VAPID_SUBJECT` looks like from here.
- **Errors**: `401 unauthenticated`, `404 not_found`, `403 not_driver`, `409 wrong_status`, `409 too_early`
- **Side effects**: updates `trip.status` and `started_at`; inserts one `notification` row per active rider (`type: "start"`) and pushes to their devices. No ledger/audit writes.

### `POST /api/trips/:id/cancel`
Driver only, `scheduled→cancelled`.

- **Auth**: required, caller must be the trip's driver
- **Request**: `{ reason?: string (max 200) }` — the literal string `not_started` is refused (`400 invalid_request`): that value is D-23's expiry sentinel, and a driver typing it would dress their own cancellation up as a trip nobody started.
- **Response**: `{ trip, notifiedRiders: number }`
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `404 not_found`, `403 not_driver`, `409 wrong_status`
- **Side effects**: updates `trip.status` and `cancelled_reason`, and notifies every active rider
  (`notification.type: "change"`, title "Trip cancelled", carrying the driver's reason verbatim when
  they gave one) — D-38. A cancellation is the one trip event a rider cannot discover by looking, and
  they need the time to find another way in. **Nobody is charged**: the riders keep their seats on a
  dead trip rather than leaving them, and a cancelled trip pays and penalises no one. No ledger/audit
  writes.

### `POST /api/trips/:id/close`
`started→closed`. Confirms which currently-active registered riders actually rode, adds any guest
riders, awards points, and — on a round trip — **materialises the return leg** (D-35).

**Not driver-only (D-35 mechanic (i)).** A **group admin** may close a ride the driver forgot to
close, because on a round trip the close is also what creates the return leg: a forgotten close
would strand everyone who declared a return. **Riders cannot close** (developer, 2026-08-30) — a
close decides who rode and moves points, and that is not an authority one passenger should hold
over another. Two forms:

| Form | Who | Confirms | No-shows | Guests | Pays the driver |
|---|---|---|---|---|---|
| `full` | the driver | only the ids in the body | everyone else | yes | yes |
| `restricted` | a group admin | **every** active rider | **none** | ignored | yes |

A restricted close ignores `confirmedTripRiderIds` and `guestNames` entirely — judging that a
colleague did not show up is a call only the driver was there to make — but still pays the normal
award, because a leg that was driven was driven regardless of who tapped the button.

- **Auth**: required, caller must be the trip's driver or a group admin of its group
- **Request**: `{ confirmedTripRiderIds?: string[] (uuid, trip_rider row ids — not profile ids — of active riders who rode; default []), guestNames?: string[] (1-80 chars each, max 20; default []) }`. Any id in `confirmedTripRiderIds` that isn't an active rider on this trip is silently ignored, not trusted.
- **Response**: `{ trip, mode: "full" | "restricted", confirmedCount: number, noShowCount: number, pointsAwarded: number, backTripId: string | null }` — `pointsAwarded` is the **driver's** own award (drive weight + fill bonus), which since D-49 is the only award a close writes.
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `404 not_found`, `403 not_permitted` (caller is neither the driver nor a group admin — riders included), `409 wrong_status` (the trip is not `started` — **including the case where another close won the race, see Exactly-once below**), `500 confirm_failed` / `no_show_failed` / `guest_add_failed` / `back_leg_failed` / `ledger_write_failed` / `update_failed`
- **Exactly-once**: closing is guarded by a compare-and-swap — `update trip set status='closed' where id=? and status='started'` — taken **before** the guest rows and the ledger are written. Two closes in flight together therefore produce one `200` and one `409 wrong_status`, never two payments. Without it both callers passed the state-machine check (a read) and both wrote a full award set; that was reproduced against the live database on 2026-08-31 and is the concurrent sibling of the sequential duplication D-41 had to clean out of the leaderboard by hand. The realistic trigger is not a double-tap but D-35 mechanic (ii): the scheduler closes round trips at T−2h before `return_at` every five minutes, so a driver tapping Close in that window races a cron job. Any failure between the claim and the ledger **releases the claim** (status back to `started`, `closed_at` cleared), so the close stays retryable exactly as before; if that release itself fails the error message says so, because the trip is then closed and unpaid.
- **Scoring (D-19, reshaped by D-42, then D-49)**: the **driver** gets exactly one `drive` entry, worth `group.drive_weight` plus a fill bonus of every seat they filled (`pool_weight + (n-1)·pool_step` summed — 3+5+7 at the defaults, guests included). That is the **only** award a close writes: since D-49 a rider earns nothing for riding, so no `pool` entry is created for anyone. Riders still see a `pooled` count — it is now a count of their confirmed seats on closed trips rather than of ledger rows (see `GET /api/groups/:id/leaderboard`). `group.rider_pool_weight` is deprecated and read by nothing. Each registered rider marked `no_show` is still charged `group.no_show_penalty` (default −10) on **their own** profile, not the driver's; guests are never penalised and earn nothing.
- **Side effects**: updates confirmed riders' `trip_rider.state` to `"confirmed"`, unconfirmed active riders to `"no_show"`; inserts a `trip_rider` row per guest (`state: "confirmed"`, `profile_id: null`); inserts `points_ledger` rows — one `drive` entry on the **driver** (`group.drive_weight` + the seat fill bonus, guests included), plus a `no_show` entry per no-showing registered rider. No rider award of any kind is written (D-49). Guests fill a seat, so they still pay the driver's bonus, but hold no profile and earn nothing themselves (D-09); inserts a `rate`-type `notification` row for each confirmed *registered* rider **whose ride ends here** (see below); updates `trip.status` and `closed_at`.
- **Return leg (D-35)**: if the trip is `direction: "round"` with a `return_at`, calls `generate_back_trip()` (`supabase/migrations/0013_round_trip_back_leg.sql`), which creates a `direction: "back"` trip at `return_at` with `parent_trip_id` set, inheriting the outbound's `capacity` and `back_stop_id`, and seats every **confirmed** rider whose `trip_rider.wants_return` is true (oldest join first, guests skipped). The generator is **idempotent** — a unique index on `trip.parent_trip_id` means the driver's close, a rider's close, an admin's close and (later) the cron tick can all call it while only one leg is ever created. If the driver already hand-published a `back` trip at that hour it is **adopted** rather than duplicated (the D-36 collision). Riders seated on it get a `change`-type notification. Generation happens **before** the ledger write, and a failure in it releases the close's claim, so it leaves the close safely retryable rather than leaving a closed trip whose return leg does not exist.
- **Kudos targeting (D-35 answer (B))**: kudos is one prompt per rider per **ride**, not per leg. Riders carried on to the return leg are *not* prompted here — they are prompted when that leg closes — so a rider travelling both ways is asked exactly once, at the end.

### `POST /api/trips/:id/join`
Join an open seat. Calls `join_trip()` (`supabase/migrations/0002_join_trip.sql`), a Postgres
function that locks the trip row (`select ... for update`) for the duration of the capacity check +
insert, so two riders racing for the last seat produce exactly one winner — verified against the
live database with concurrent requests on a 1-seat trip.

- **Auth**: required, caller must be a member of the trip's group and not its driver
- **Request**: `{ wantsReturn: boolean }` — **required, no default** (D-35 answer (C)). Joining a round trip asks outright whether the rider is coming back with the same driver; there is deliberately no opt-in/opt-out default, so a join that never asked the question is a `400` rather than a silent "not returning". Forced to `false` on a one-way trip, which has no return leg to declare for.
- **Response**: `201 { tripRider }`
- **Errors**: `401 unauthenticated`, `400 invalid_request` (missing `wantsReturn`), `404 not_found`, `429 rate_limited` (20/10min per caller), `409 is_driver`, `409 wrong_status` (not scheduled), `409 already_joined`, `409 full`, `409 departed` (D-23 — departure time has passed; only the driver can seat anyone after that)
- **Side effects**: inserts a `trip_rider` row (`state: "joined"`, `wants_return` as answered). No ledger writes on join, and none on close either: a rider earns no points at all (D-49). The seat itself is what the rider's `pooled` count is drawn from once the trip closes. The declaration does nothing until the outbound closes, at which point a `true` seats the rider on the generated return leg and a `false` is what frees that seat for everyone else — never before (D-35).

### `POST /api/trips/:id/leave`
Drop a seat you're holding.

- **Auth**: required, caller must hold an active seat on the trip
- **Request**: none
- **Response**: `{ tripRider, latePenalty: number | null, penaltyWaived: boolean }`
- **Errors**: `401 unauthenticated`, `404 not_found` (trip missing or caller isn't riding it), `409 wrong_status` (trip already closed/cancelled), `500 seat_lookup_failed`, `500 leave_failed`
- **Side effects**: updates the `trip_rider` row (`state: "left"`, `left_at`). A failed seat lookup is `500 seat_lookup_failed`, never `404` — telling a rider who holds a seat that they don't would leave them on a trip they believe they left. If the leave falls inside the group's configured cancellation window (`group.late_window_minutes`, default 60 — from `windowMinutes` before departure through any time after), inserts a `late_leave` `points_ledger` entry (`group.late_penalty`, default -5) for the leaving rider. **Exception (D-24):** a seat the driver added (`trip_rider.added_by_profile_id` set) is never penalised — the rider never booked it. **Exception (D-38):** a seat whose trip changed under the rider (`trip_rider.penalty_waived_at` set by `PATCH /api/trips/:id`) is never penalised either, at any distance from departure — the window exists to stop people dropping out at the last minute on a plan that never moved, and the plan moved. The response's `penaltyWaived` says which rule applied.

### `POST /api/trips/:id/riders`
Driver seats a group member who asked for the ride in person (D-24). Calls `add_trip_rider()`
(`supabase/migrations/0010`), which takes the same row lock as `join_trip()` — a driver adding
someone while a rider self-joins is exactly that race. Unlike joining, this still works after
departure, for as long as the trip is alive (D-23's 24h grace window).

- **Auth**: required, caller must be the trip's driver
- **Request**: `{ profileId: string (uuid) }`
- **Response**: `201 { tripRider }`
- **Errors**: `401 unauthenticated`, `400 invalid_request`, `404 not_found`, `403 not_driver`, `409 is_driver`, `409 wrong_status` (trip closed/cancelled), `409 not_member` (not in the trip's group), `409 already_joined`, `409 full`
- **Side effects**: inserts a `trip_rider` row (`state: "joined"`, `added_by_profile_id` = caller); notifies the added member (`type: "change"`) + push; writes an `audit_log` row (`trip_rider_added_by_driver`).

### `DELETE /api/trips/:id/riders/:riderId`
Driver takes back a seat they booked for someone (D-24). Limited to seats the driver added — a
rider who joined of their own accord gives up their seat through `POST /leave`, and a driver must
not be able to bump them.

- **Auth**: required, caller must be the trip's driver
- **Request**: none
- **Response**: `{ tripRider }`
- **Errors**: `401 unauthenticated`, `404 not_found` (trip missing, or that rider isn't on it), `403 not_driver`, `403 not_added_by_driver`, `409 wrong_status`, `500 remove_failed`
- **Side effects**: updates the `trip_rider` row (`state: "left"`, `left_at`); notifies the removed member + push; writes an `audit_log` row (`trip_rider_removed_by_driver`). No ledger writes — a driver undoing their own action isn't a late cancellation.

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
Calendar-month ranking (D-12 — the ledger itself stays all-time; only this view's window resets
monthly), weighted per the group's own `drive_weight`/`pool_weight`/`kudos_weight` (D-11). `driven` is a **row count** of
the caller's own `drive` entries. `pooled` is **not** a ledger figure since D-49: riding earns nothing, so it is
counted from the caller's `confirmed` `trip_rider` seats on trips closed in the window. It means rides
taken as a passenger, not passengers carried (D-42's correction, kept). Every group member appears,
even with zero points this month — and a member who has only ever ridden appears with their `pooled`
count and a score of `0`.

- **Auth**: required, caller must be a member of `:id`
- **Request**: none
- **Response**: `{ entries: RankedRow[] (profileId, name, initials, color, driven, pooled, kudos, points, rank, medal: string | null), formula: string, viewerProfileId: string }`
- **Errors**: `401 unauthenticated`, `404 not_found`
- **Side effects**: none

### `GET /api/me/points`
The caller's own lifetime totals — all-time, across every group they belong to (D-12: only the
group leaderboard view is month-scoped, the ledger itself never resets). `pooled` is the one figure
here that is not a ledger total: since D-49 riding earns nothing, so it counts the caller's
`confirmed` seats on closed trips instead (all-time, like the rest).

- **Auth**: required
- **Request**: none
- **Response**: `{ driven: number, pooled: number, kudos: number, points: number, stopsThisMonth: number }`
- **Errors**: `401 unauthenticated`
- **Side effects**: none
- **Notes**: `stopsThisMonth` (D-29) counts `closed` trips this calendar month that passed through a
  stop and that the caller drove or rode (`state: "confirmed"`). Unlike the four totals above it is
  month-scoped, and it is **not** a ledger figure — stops score no points, so this number can never
  move the leaderboard.

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
Called every 5 minutes by the `carpool-tick` pg_cron job in Supabase (D-21, migration `0008`),
which posts here through `pg_net` with the `CRON_SECRET` header; `GET` is kept for triggering a tick
by hand with curl. Five jobs per
tick, in this order: (1) departure reminders — any
`scheduled` trip departing within `DEPARTURE_REMINDER_LEAD_MINUTES` (15) gets a `reminder`-type
notification + push to its driver and active riders, deduped against an existing reminder row
carrying that trip's id. The window also reaches `DEPARTURE_REMINDER_GRACE_MINUTES` (5) *behind*
now, so a trip whose departure slipped past between two ticks still gets a slightly late reminder
instead of none at all; (1b) **close reminders** — a trip left `started` for
`CLOSE_REMINDER_AFTER_MINUTES` (90) sends a `close_reminder`-type notification + push to its
**driver only**, since the driver is the only person who can close a trip and therefore the only
one who can act on it. Closing is what writes `points_ledger`, so until it happens the ride has paid
nobody; the 6h auto-close in job (3) is a tidier rather than a substitute, because it awards
nothing. Deduped the same way, on its own notification type — see [D-39]; (2) **return-leg
generation (D-35 mechanic (ii))** — a `round` trip still `started`
within `RETURN_LEG_LEAD_MINUTES` (120) of its `return_at`, with no leg built yet, is closed by the
scheduler in the same **restricted** form an admin gets: every active rider confirmed, nobody marked
`no_show`, **the driver paid in full**, and the return leg materialised. The deadline is measured
against the *return* departure, so a rider learns two hours out whether they have a seat home. This
job runs **before** the auto-close, and any round trip still owed a leg is **skipped** by it — on a
normal commute (out 08:00, back 18:00) the 6h stale mark falls at 14:00, before the 16:00 deadline,
so without that skip the auto-close would take the trip first, close it for zero points and leave
the return unbuilt; (3) auto-close — any *other* trip left `started` for 6+ hours is force-closed as
a safety net (never touches `points_ledger` — no driver confirmed who actually rode); (4) expiry (D-23) — any
trip still `scheduled` 24 hours (`UNSTARTED_GRACE_HOURS`) after its departure time is ended as
`cancelled` with `cancelled_reason: "not_started"`. No points and no penalties: an expiry is the
absence of a trip, not anyone's fault. That update is re-guarded on `status = 'scheduled'`, so a
trip started between the read and the write is left alone.

- **Auth**: `Authorization: Bearer <CRON_SECRET>`. The scheduler reads both the URL and the secret from Supabase Vault (`carpool_tick_url`, `carpool_cron_secret`) at call time, so neither is in any tracked file; with either missing the job returns without calling anything.
- **Request**: none
- **Response**: `{ failures: string[], remindersSent: number, reminderFailures: number, closeRemindersSent: number, closeReminderFailures: number, returnLegsGenerated: number, autoClosed: number, expired: number }`. Each trip is processed in isolation: a throw is recorded in `failures` as `<job>/<tripId>: <message>` and the sweep moves on, because the five jobs run in one request and an unhandled throw used to abort every job after it — permanently, since the next tick meets the same data. The `*Failures` counts are how a broken notification path becomes visible: `notifyProfiles` returns its insert error rather than discarding it, so a tick that could not write its rows reports a number instead of looking idle.
- **Errors**: `401 unauthorized`
- **Side effects**: inserts `notification` rows (`type: "reminder"` for departures, `type: "close_reminder"` for unclosed trips, `type: "change"` for expiries, `type: "change"` to the back leg's riders when one is generated) + sends push; updates stale trips' `status`/`closed_at` and expired trips' `status`/`cancelled_reason`; **writes `points_ledger` for a generated return leg** — the one place the scheduler moves points, and deliberately so: the outbound was driven whether or not anyone remembered to close it; inserts an `audit_log` row per generation (`cron_generate_return_leg`), per auto-close (`cron_auto_close`) and per expiry (`cron_expire_unstarted`), plus one `cron_tick_failures` row (`entity_id: null`) for any tick that could not process a trip — the response body is only read by `pg_net`, which discards it, so isolation without this record would just be a quieter version of the same silent failure. All carry `actor_profile_id: null`, marking them system-acted.

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

### `POST /api/admin/trips/:id/force-close`
Safety-net close for a stuck trip — and, since D-35, the way an admin generates a return leg for a
driver who forgot to close. **This route used to never touch `points_ledger`; D-35 answer (A)
retired that rule for started trips**, because a forgotten close now costs the driver both legs'
awards and strands every rider who declared a return.

Two behaviours, by the trip's status:

| Status | What happens | `mode` |
|---|---|---|
| `started` | the full **restricted close** — every active rider confirmed, nobody marked `no_show`, driver paid, return leg generated | `"restricted"` |
| `scheduled` | status-only close, as before — no ride happened, so nothing to pay for and no leg to build | `"status_only"` |

- **Auth**: `platform_admin`
- **Request**: `{ reason: string (1-500 chars, required) }`
- **Response**: `{ trip, mode }`; for a started trip also `{ confirmedCount, pointsAwarded, backTripId }`
- **Errors**: `401 unauthenticated`, `403 forbidden`, `400 invalid_request`, `404 not_found`, `409 wrong_status` (already closed/cancelled), `500 update_failed`, plus the close route's `500` codes for a started trip
- **Side effects**: sets `trip.status = "closed"`/`closed_at`; inserts an `audit_log` row (`action: "force_close_trip"`, `after` includes the required reason, the `mode`, and — for a started trip — `confirmedCount`, `pointsAwarded` and `backTripId`). For a started trip, every side effect of a restricted `POST /api/trips/:id/close` as well.

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
