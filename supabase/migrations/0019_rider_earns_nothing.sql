-- D-49: a rider earns no points. Developer, 2026-08-31: "The rider shouldn't have any point."
--
-- This does NOT reverse D-42. D-42 asked that a rider be able to see how often they were pooled,
-- and they still can. What changes is where that number comes from:
--
--   before (D-42)  one `pool` ledger row per rider per ride, worth rider_pool_weight.
--                  `pooled` = count of those rows. The rider scored 3 a ride.
--   after  (D-49)  no rider row at all. `pooled` = count of the rider's confirmed trip_rider
--                  seats on closed trips. The count survives; it is worth nothing.
--
-- Counting the seats rather than the ledger is not a stylistic choice, it is the only shape that
-- works. points_ledger carries `check (points <> 0)` (0001_init.sql), so "keep the row but make it
-- worth zero" is not storable: a zero-point insert is rejected and takes the whole close down with
-- it. That is the same trap D-43 found behind kudos_weight = 0. Deriving the count from the seats
-- also decouples the display from the ledger, which is what made the D-41 duplicate-award incident
-- show up on screen as "12 pooled" in the first place.
--
-- The driver is untouched: still drive_weight + the escalating seat bonus, guests included, so
-- D-19's economics keep their value exactly.

-- rider_pool_weight is left in place rather than dropped. It is read by nothing after this
-- migration, and dropping a column is irreversible without a restore; keeping it costs an int per
-- group and leaves the door open if riders are ever paid again. Re-commented so nobody wires it
-- back up by accident.
comment on column "group".rider_pool_weight is
  'DEPRECATED (D-49, 2026-08-31): riders earn no points, so nothing reads this. Retained, not dropped, so the value is recoverable if rider scoring ever returns. A rider''s "pooled" count now comes from their confirmed trip_rider seats on closed trips, not from points_ledger.';

comment on column "group".pool_weight is
  'D-42/D-49: prices the first seat of the driver''s fill bonus, folded into the drive award at close. Paid to the DRIVER. Riders earn nothing.';

comment on column "group".pool_step is
  'D-42/D-49 (was D-19): added to each successive seat of the driver''s fill bonus. The nth confirmed rider adds pool_weight + (n-1)*pool_step to the DRIVER''s drive award. Zero restores flat seat pricing.';
