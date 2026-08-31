-- D-42: "pooled" is the RIDER's stat, not the driver's.
--
-- D-19 wrote one `pool` ledger row per confirmed rider onto the DRIVER, so a driver who carried
-- four people read "4 pooled" and the four people who were actually pooled read "0 pooled" — the
-- opposite of what the word means, and it left riders unable to score at all.
--
-- From here a `pool` row belongs to the rider who took the ride, one per ride, worth
-- rider_pool_weight. The driver's incentive to fill the car is unchanged in value but moves into
-- the `drive` row: drive_weight + the same escalating seat sum pool_weight + (n-1)*pool_step.
-- pool_weight and pool_step therefore still price a seat, they just pay through `drive` now.

alter table "group" add column if not exists rider_pool_weight int not null default 3;

comment on column "group".rider_pool_weight is
  'D-42: what one ride as a passenger is worth to the RIDER. Flat, one per ride — seat escalation is the driver''s incentive and is paid through drive_weight, not here.';

comment on column "group".pool_weight is
  'D-42: prices the first seat of the driver''s fill bonus, folded into the drive award at close. Not what a rider earns — that is rider_pool_weight.';

comment on column "group".pool_step is
  'D-42 (was D-19): added to each successive seat of the driver''s fill bonus. The nth confirmed rider adds pool_weight + (n-1)*pool_step to the driver''s drive award. Zero restores flat seat pricing.';
