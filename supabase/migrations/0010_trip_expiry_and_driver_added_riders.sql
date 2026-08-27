-- D-23 (unstarted trips expire) and D-24 (driver-added passengers).
--
-- Two related changes to how a seat comes to exist and how long a trip stays live:
--
-- 1. join_trip() gains a departure guard. A scheduled trip stayed joinable forever, so a trip
--    three days past its departure still advertised open seats. Self-serve joining now stops at
--    depart_at; only the driver can seat anyone after that (see add_trip_rider below).
-- 2. trip_rider.added_by_profile_id records the driver who booked a seat on a member's behalf.
--    That member never opted in, so POST /api/trips/:id/leave must not charge them the late
--    cancellation penalty — the column is what tells the two kinds of seat apart.

alter table trip_rider
  add column if not exists added_by_profile_id uuid references profile (id) on delete set null;

comment on column trip_rider.added_by_profile_id is
  'Driver who seated this rider (D-24). Null for a seat the rider booked themselves — only those carry the late-cancellation penalty.';

-- Same body as 0002 plus the departure guard. Kept as a full replace rather than a patch so the
-- function reads as one piece; the locking contract (select ... for update) is unchanged.
create or replace function public.join_trip(p_trip_id uuid, p_profile_id uuid)
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
  select id, driver_id, status, capacity, depart_at into v_trip
  from trip
  where id = p_trip_id
  for update;

  if not found then
    raise exception 'trip_not_found';
  end if;

  if v_trip.driver_id = p_profile_id then
    raise exception 'is_driver';
  end if;

  if v_trip.status <> 'scheduled' then
    raise exception 'wrong_status';
  end if;

  -- D-23: the trip may still be started late by its driver, but nobody may take a seat on a ride
  -- that has already left.
  if v_trip.depart_at <= now() then
    raise exception 'departed';
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

  insert into trip_rider (trip_id, profile_id, state)
  values (p_trip_id, p_profile_id, 'joined')
  returning * into v_rider;

  return v_rider;
end;
$$;

revoke execute on function public.join_trip(uuid, uuid) from public, anon, authenticated;

-- D-24: the driver seats a group member. Same capacity lock as join_trip — a driver adding someone
-- while a rider self-joins is exactly the race join_trip was written to close. Differences from
-- join_trip: the actor must be the trip's driver, the passenger must be a member of the trip's
-- group, a started trip still accepts passengers (someone got in at the kerb), and there is no
-- departure guard at all — D-23 gives the driver 24h after departure to put the trip right.
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

  if v_trip.status not in ('scheduled', 'started') then
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
  values (p_trip_id, p_profile_id, 'joined', p_added_by)
  returning * into v_rider;

  return v_rider;
end;
$$;

revoke execute on function public.add_trip_rider(uuid, uuid, uuid) from public, anon, authenticated;
