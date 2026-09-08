-- D-56 — the driver is paid when they press Start, not when they close.
--
-- The developer, 2026-09-07: "Remove the end trip. No user is using that." Closing was the only
-- thing that ever wrote points_ledger, so drivers who never tapped it were never paid — the ride
-- ran, the car was full, and the leaderboard showed nothing. Payment moves to `start`, which is the
-- tap drivers actually make.
--
-- A seat count read at Start is a forecast, not a fact: someone gets in at the kerb, someone bails,
-- and the driver marks a no-show at close. The developer asked for the award to follow ("Yes,
-- correct them"). points_ledger is append-only (CLAUDE.md §3.5), so a correction is a NEW ROW
-- carrying the difference, never an edit to the original `drive` row.
--
-- Why a `drive_adjust` kind and not another `drive` row: leaderboard.ts#aggregateLedger counts
-- `driven` as the NUMBER of `drive` rows, one per trip driven. A second `drive` row on the same
-- trip would report a driver as having driven twice. `drive_adjust` carries points and nothing
-- else — summed into the score, counted in no total.
--
-- Why not `admin_adjust`: that kind means a human overrode the system by hand (see the 2026-09-04
-- worklog entry). Filing an automatic seat-count correction under it would make every real manual
-- intervention unfindable.
alter table points_ledger drop constraint if exists points_ledger_kind_check;
alter table points_ledger add constraint points_ledger_kind_check
  check (kind in ('drive', 'pool', 'kudos', 'late_leave', 'no_show', 'admin_adjust', 'drive_adjust'));

comment on column points_ledger.kind is
  'D-56: `drive` is the award written when a trip starts, one per trip driven. `drive_adjust` is a later correction to that award after the seat count changed — points only, never counted as a drive.';
