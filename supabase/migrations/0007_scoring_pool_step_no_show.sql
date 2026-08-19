-- D-19 — scoring rework (developer, 2026-08-19). Three changes, all per-group so they stay tunable
-- without another migration, and all forward-only: points_ledger is append-only, so existing rows
-- keep whatever they were worth when written. Nothing is recomputed.
--
--   1. Pooling escalates per seat. The nth rider is worth pool_weight + (n-1)·pool_step, so the
--      defaults pay 3, 5, 7 instead of 3, 3, 3 — filling the car is worth disproportionately more.
--   2. A no-show now costs the rider who booked the seat and didn't ride. The `no_show` state has
--      been recorded at close since Phase 4 and carried no consequence until now.
--   3. (No column needed) a kudos is scaled by the trip's confirmed rider count in the API.

alter table "group" add column if not exists pool_step int not null default 2;
alter table "group" add column if not exists no_show_penalty int not null default -10;

comment on column "group".pool_step is
  'D-19: added to each successive seat. The nth confirmed rider is worth pool_weight + (n-1)*pool_step. Zero restores the old flat pooling.';
comment on column "group".no_show_penalty is
  'D-19: charged to a registered rider who booked a seat and was not confirmed at close. Negative. Guests are never penalised — they have no profile to hold points.';

-- points_ledger gains a `no_show` kind. The check constraint is replaced wholesale because Postgres
-- has no "add value to a check constraint" — this is the same pattern as 0003's notification.type.
alter table points_ledger drop constraint if exists points_ledger_kind_check;
alter table points_ledger add constraint points_ledger_kind_check
  check (kind in ('drive', 'pool', 'kudos', 'late_leave', 'no_show', 'admin_adjust'));
