-- D-63 (developer, 2026-09-28): a ride settles by itself at its departure time (D-61), so a driver
-- who could not leave at that hour is left with a ride the app counted and paid although nobody
-- went. The driver can now POSTPONE it, the same day only, to a later time: everything the settle
-- did is rolled back and the ride goes back to being one that is still ahead, with its riders.
--
-- 1. points_ledger stays append-only (CLAUDE.md §3.5). Nothing it holds is edited or deleted: each
--    row the ride paid is cancelled by a NEW `postpone_void` row carrying the negated figure and
--    naming the row it cancels. `reverses_id` is unique, so no row can be cancelled twice, and the
--    shape check keeps a void and its reference inseparable.
alter table points_ledger drop constraint if exists points_ledger_kind_check;
alter table points_ledger add constraint points_ledger_kind_check
  check (kind in ('drive', 'pool', 'kudos', 'late_leave', 'no_show', 'admin_adjust', 'drive_adjust',
                  'no_show_report', 'postpone_void'));

alter table points_ledger add column if not exists reverses_id uuid references points_ledger (id);
create unique index if not exists points_ledger_reverses_once on points_ledger (reverses_id)
  where reverses_id is not null;
alter table points_ledger drop constraint if exists points_ledger_void_shape;
alter table points_ledger add constraint points_ledger_void_shape
  check ((kind = 'postpone_void') = (reverses_id is not null));

-- 2. When the ride was last postponed. The scheduler's reminder and parking jobs send one
--    notification per trip; after a postpone they must send one again for the new time
--    (developer: "resend after postpone"), so they only look for notifications newer than this.
alter table trip add column if not exists postponed_at timestamptz;

-- 3. The rollback, in one transaction so a half-postponed ride cannot exist. The same-day bound
--    needs the driver's zone and is checked by the API route (src/domain/tripPostpone.ts); this
--    re-checks everything that does not need one.
create or replace function public.postpone_trip(p_trip_id uuid, p_new_depart_at timestamptz)
returns trip
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip trip;
  v_seats int;
begin
  select * into v_trip from trip where id = p_trip_id for update;
  if not found then
    raise exception 'trip_not_found';
  end if;
  if v_trip.status <> 'closed' then
    raise exception 'wrong_status';
  end if;
  if p_new_depart_at <= now() then
    raise exception 'not_later';
  end if;
  if v_trip.return_at is not null and p_new_depart_at >= v_trip.return_at then
    raise exception 'after_return';
  end if;

  -- Every figure the ride wrote: the driver's pay and its corrections, kudos, and both sides of a
  -- no-show report. A late_leave is not touched: that rider left before the ride was due, which
  -- is still true. Rows already cancelled by an earlier postpone are skipped.
  insert into points_ledger (profile_id, group_id, trip_id, kind, points, reason, reverses_id)
  select l.profile_id, l.group_id, l.trip_id, 'postpone_void', -l.points, 'Ride postponed', l.id
  from points_ledger l
  where l.trip_id = p_trip_id
    and l.kind in ('drive', 'drive_adjust', 'kudos', 'no_show', 'no_show_report')
    and not exists (select 1 from points_ledger v where v.reverses_id = l.id);

  -- Kudos are given for a ride that happened; this one has not yet. The riders can give it again
  -- once it does (the ledger keeps the old row and its void).
  delete from kudos where trip_id = p_trip_id;

  -- Everyone who was in the car, including anyone reported as a no-show, holds a seat again. The
  -- ride they booked is not the one they have now, so leaving is free (D-38's waiver).
  update trip_rider
     set state = 'joined', kudos_declined_at = null, penalty_waived_at = now()
   where trip_id = p_trip_id
     and state in ('confirmed', 'no_show');

  -- A seat freed by a no-show could have been handed to someone else; bringing the no-show back
  -- then needs one more seat. Grown to fit, never past the 7-seat maximum.
  select count(*) into v_seats
  from trip_rider
  where trip_id = p_trip_id and state in ('joined', 'confirmed');

  update trip
     set status = 'scheduled',
         closed_at = null,
         depart_at = p_new_depart_at,
         postponed_at = now(),
         capacity = greatest(capacity, least(v_seats, 7))
   where id = p_trip_id
  returning * into v_trip;

  return v_trip;
end;
$$;

revoke execute on function public.postpone_trip(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.postpone_trip(uuid, timestamptz) to service_role;
