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
  add constraint trip_return_after_depart check (return_at is null or return_at > depart_at);

-- Checked before applying: 3 of the 24 existing rows predate this rule — all `depart_at` set
-- earlier than `created_at`, and all already terminal (2 `cancelled`, 1 `closed`), from before the
-- API enforced this. A validating ADD CONSTRAINT would fail outright on them. NOT VALID grandfathers
-- those rows as-is (they're history, not something anyone can act on again) while still enforcing
-- the rule on every INSERT and on any future UPDATE that touches depart_at/created_at on any row —
-- which is what actually matters, since the old data can no longer be re-scheduled through the app.
alter table trip
  add constraint trip_depart_not_before_created check (depart_at >= created_at) not valid;
