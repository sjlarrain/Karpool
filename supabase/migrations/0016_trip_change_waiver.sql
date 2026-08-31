-- D-38 — a rider leaves a trip that changed under them for free.
--
-- A driver can now edit a scheduled trip from the app (PATCH /api/trips/:id), and moving the
-- departure or adding a detour changes the deal the riders agreed to. The late-cancellation
-- charge (D-10: -5 within 60 minutes of departure) exists to stop people dropping out at the last
-- moment on a plan that never changed; charging it to someone whose 07:45 ride became an 08:30
-- ride would punish them for the driver's decision.
--
-- The waiver is a property of the SEAT, not of the trip: only riders who were already aboard when
-- the edit landed get it. Someone who joins after the change is agreeing to the new plan and is
-- covered by the normal window, so a fresh join starts with this column null.
--
-- Additive and nullable, so the currently-deployed build (which never selects this column) keeps
-- working either side of the migration — no deploy shim needed, unlike 0013.

alter table trip_rider
  add column if not exists penalty_waived_at timestamptz;

comment on column trip_rider.penalty_waived_at is
  'Set when the driver materially changed the trip under this rider (D-38). While set, POST /api/trips/:id/leave charges no late-cancellation penalty. Null on a seat taken after the change.';
