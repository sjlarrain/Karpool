-- D-47: nothing stopped a trip departing in the past, or returning before it departs. The API now
-- rejects both with a 400 (src/domain/tripSchedule.ts), and this is the database backstop the
-- decision also called for.
--
-- Neither constraint references now(), on purpose: a CHECK that did would be re-evaluated on every
-- future UPDATE to the row, and D-23 relies on a driver being able to start or close a trip up to
-- 24h after its depart_at has already passed — that UPDATE must not start failing just because the
-- clock moved on. `depart_at >= created_at` is the immutable proxy instead: created_at is fixed at
-- insert, so a trip cannot depart before the moment it was created, which is exactly what "not in
-- the past" means at creation time, without ever re-checking against the live clock afterward.
alter table trip
  add constraint trip_depart_not_before_created check (depart_at >= created_at),
  add constraint trip_return_after_depart check (return_at is null or return_at > depart_at);
