-- D-18 — the kudos prompt had no "no thanks" path. The sketch's rate overlay has a kudos toggle and
-- submits either way; the built version only offered "Send kudos", so a rider who did not want to
-- give kudos could never clear the prompt off a closed trip.
--
-- The decline is recorded rather than dismissed client-side, so it stays cleared on every device.
-- It lives on trip_rider, not kudos: `kudos` means "kudos was given" and every row there drives a
-- points_ledger insert, so a declined row in that table would look like a kudos to anything that
-- counts them. trip_rider is already the per-rider-per-trip record.

alter table trip_rider add column if not exists kudos_declined_at timestamptz;

comment on column trip_rider.kudos_declined_at is
  'Set when the rider explicitly closed the kudos prompt without giving kudos (D-18). Null means the prompt is still pending.';
