-- D-61 (developer, 2026-09-19) — the automatic trip lifecycle. Start and Close are gone: the
-- scheduler settles a trip at its departure time, and the driver has until the end of that day to
-- fix the ride list. This migration carries the schema half of that.

-- 1. The driver is paid for reporting a no-show ("-5 for the rider +2 for the driver"). Its own
--    kind, not `drive_adjust`: it is not a re-pricing of the seats — the driver keeps the no-show's
--    seat pay — and aggregateLedger must never mistake it for one.
alter table points_ledger drop constraint if exists points_ledger_kind_check;
alter table points_ledger add constraint points_ledger_kind_check
  check (kind in ('drive', 'pool', 'kudos', 'late_leave', 'no_show', 'admin_adjust', 'drive_adjust', 'no_show_report'));

-- 2. Both weights are per group (D-11). The rider's penalty drops from -10 to -5; groups still on
--    the old default follow it, a group that had deliberately chosen another figure keeps it.
alter table "group" add column if not exists no_show_report_bonus int not null default 2
  check (no_show_report_bonus > 0);
comment on column "group".no_show_report_bonus is
  'D-61: paid to the driver for reporting a no-show after the ride. Positive.';

alter table "group" alter column no_show_penalty set default -5;
update "group" set no_show_penalty = -5 where no_show_penalty = -10;

-- 3. The driver's "pay for parking" push, 30 minutes after a leg departs.
alter table notification drop constraint if exists notification_type_check;
alter table notification add constraint notification_type_check
  check (type in ('start', 'rate', 'change', 'comment', 'tip', 'reminder', 'close_reminder', 'join', 'leave', 'parking'));

-- 4. The one-time "what's new" sheet. Holds the key of the last announcement this person closed, so
--    a later announcement shows again without a schema change.
alter table profile add column if not exists seen_announcement text;

-- 5. D-60: a generated return leg is dated from its PARENT. The leg was promised when the outbound
--    was published, so D-47's "no scheduling into the past" check has nothing to say about it —
--    and a late settle must never be refused because the return time has already passed.
--    Body is 0013's, unchanged apart from the insert's created_at.
create or replace function public.generate_back_trip(p_parent_trip_id uuid)
returns trip
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent record;
  v_back trip;
  v_seats_left int;
begin
  select id, group_id, driver_id, direction, return_at, capacity, back_stop_id, created_at
    into v_parent
  from trip
  where id = p_parent_trip_id
  for update;

  if not found then
    raise exception 'trip_not_found';
  end if;

  if v_parent.direction <> 'round' or v_parent.return_at is null then
    return null;
  end if;

  -- Already materialised: return it unchanged (idempotency).
  select * into v_back from trip where parent_trip_id = p_parent_trip_id limit 1;
  if found then
    return v_back;
  end if;

  -- D-36: adopt the driver's hand-published return at that hour rather than inserting beside it.
  select * into v_back
  from trip
  where driver_id = v_parent.driver_id
    and group_id = v_parent.group_id
    and direction = 'back'
    and status = 'scheduled'
    and parent_trip_id is null
    and date_trunc('hour', depart_at) = date_trunc('hour', v_parent.return_at)
  limit 1;

  if found then
    update trip set parent_trip_id = p_parent_trip_id where id = v_back.id returning * into v_back;
  else
    insert into trip (group_id, driver_id, direction, depart_at, capacity, status, back_stop_id, parent_trip_id, created_at)
    values (v_parent.group_id, v_parent.driver_id, 'back', v_parent.return_at, v_parent.capacity,
            'scheduled', v_parent.back_stop_id, p_parent_trip_id, v_parent.created_at)
    returning * into v_back;
  end if;

  select v_back.capacity - count(*) into v_seats_left
  from trip_rider
  where trip_id = v_back.id and state in ('joined', 'confirmed');

  insert into trip_rider (trip_id, profile_id, pickup_place_id, stop_order, state, wants_return)
  select v_back.id, tr.profile_id, tr.pickup_place_id, tr.stop_order, 'joined', false
  from trip_rider tr
  where tr.trip_id = p_parent_trip_id
    and tr.state = 'confirmed'
    and tr.wants_return
    and tr.profile_id is not null
    and tr.profile_id <> v_parent.driver_id
    and not exists (
      select 1 from trip_rider x
      where x.trip_id = v_back.id
        and x.profile_id = tr.profile_id
        and x.state in ('joined', 'confirmed')
    )
  order by tr.joined_at
  limit greatest(v_seats_left, 0);

  return v_back;
end;
$$;

revoke execute on function public.generate_back_trip(uuid) from public, anon, authenticated;
grant execute on function public.generate_back_trip(uuid) to service_role;

-- 6. After departure the driver can seat someone who rode without booking — until the end of that
--    day (D-61). A settled trip is `closed`, so both seating functions now accept it, and a seat
--    added to a ride that already happened goes straight in as `confirmed`: nobody needs to confirm
--    a ride the driver is telling us about after the fact. The END-OF-DAY bound needs the driver's
--    time zone, which only the request carries, so the API route enforces it before calling these.
--    `started` is no longer accepted — D-61 left no way into it.
--    Bodies are 0010's and 0022's, unchanged apart from the status check and the inserted state.
create or replace function public.add_trip_rider(p_trip_id uuid, p_profile_id uuid, p_added_by uuid)
returns trip_rider
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip record;
  v_active_count int;
  v_rider trip_rider;
begin
  select id, driver_id, status, capacity, group_id into v_trip
  from trip
  where id = p_trip_id
  for update;

  if not found then
    raise exception 'trip_not_found';
  end if;

  if v_trip.driver_id <> p_added_by then
    raise exception 'not_driver';
  end if;

  if v_trip.driver_id = p_profile_id then
    raise exception 'is_driver';
  end if;

  if v_trip.status not in ('scheduled', 'closed') then
    raise exception 'wrong_status';
  end if;

  if not exists (
    select 1 from membership
    where group_id = v_trip.group_id and profile_id = p_profile_id
  ) then
    raise exception 'not_member';
  end if;

  if exists (
    select 1 from trip_rider
    where trip_id = p_trip_id and profile_id = p_profile_id and state in ('joined', 'confirmed')
  ) then
    raise exception 'already_joined';
  end if;

  select count(*) into v_active_count
  from trip_rider
  where trip_id = p_trip_id and state in ('joined', 'confirmed');

  if v_active_count >= v_trip.capacity then
    raise exception 'full';
  end if;

  insert into trip_rider (trip_id, profile_id, state, added_by_profile_id)
  values (p_trip_id, p_profile_id,
          case when v_trip.status = 'closed' then 'confirmed' else 'joined' end, p_added_by)
  returning * into v_rider;

  return v_rider;
end;
$$;

revoke execute on function public.add_trip_rider(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.add_trip_guest(p_trip_id uuid, p_group_guest_id uuid, p_added_by uuid)
returns trip_rider
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip record;
  v_guest record;
  v_active_count int;
  v_rider trip_rider;
begin
  select id, driver_id, status, capacity, group_id into v_trip
  from trip
  where id = p_trip_id
  for update;

  if not found then
    raise exception 'trip_not_found';
  end if;

  if v_trip.driver_id <> p_added_by then
    raise exception 'not_driver';
  end if;

  if v_trip.status not in ('scheduled', 'closed') then
    raise exception 'wrong_status';
  end if;

  select id, group_id, display_name into v_guest
  from group_guest
  where id = p_group_guest_id;

  if not found then
    raise exception 'guest_not_found';
  end if;

  if v_guest.group_id <> v_trip.group_id then
    raise exception 'wrong_group';
  end if;

  if exists (
    select 1 from trip_rider
    where trip_id = p_trip_id and group_guest_id = p_group_guest_id and state in ('joined', 'confirmed')
  ) then
    raise exception 'already_joined';
  end if;

  select count(*) into v_active_count
  from trip_rider
  where trip_id = p_trip_id and state in ('joined', 'confirmed');

  if v_active_count >= v_trip.capacity then
    raise exception 'full';
  end if;

  insert into trip_rider (trip_id, group_guest_id, guest_name, state, added_by_profile_id)
  values (p_trip_id, p_group_guest_id, v_guest.display_name,
          case when v_trip.status = 'closed' then 'confirmed' else 'joined' end, p_added_by)
  returning * into v_rider;

  return v_rider;
end;
$$;

revoke execute on function public.add_trip_guest(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.add_trip_guest(uuid, uuid, uuid) to service_role;
