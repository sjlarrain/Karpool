-- D-35 (round-trip return leg), first slice: close + spawn + the join question.
--
-- The return leg stops being a second departure hidden inside one row and becomes a real trip of
-- its own, created lazily when the outbound closes. Every recorded breakage of the old shape came
-- from one row owning two departures: started_at/closed_at could only describe one of them, D-16's
-- T-2h start guard and D-23's 24h expiry both measured against depart_at, and the points engine
-- settles at close -- once, for a ride that actually happened twice.
--
-- Deferred to a follow-up, deliberately: the T-2h auto-generation (D-35 mechanic (ii)) belongs in
-- /api/cron/tick, which has no caller until the Vault secrets land (D-21). Until then the rider or
-- admin close below IS the safety net for a driver who forgets.

-- === 1. the link between the two legs =======================================
-- Load-bearing, not cosmetic. Four separate paths can now ask for the back trip to be created --
-- the driver's close, a rider's close, an admin's close, and later the cron tick -- and nothing on
-- the outbound row otherwise records that the return already exists (direction stays 'round' and
-- return_at stays set forever). Without the unique index below, any two of them racing produce two
-- back trips and the returning riders are split across them.
alter table trip
  add column if not exists parent_trip_id uuid references trip (id) on delete cascade;

create unique index if not exists trip_one_back_leg_per_parent
  on trip (parent_trip_id)
  where parent_trip_id is not null;

comment on column trip.parent_trip_id is
  'D-35: the outbound round trip this back leg was generated from. Unique -- a round trip has at most one return leg, which is what makes generate_back_trip() idempotent across the driver, rider, admin and cron close paths.';

-- === 2. the rider's declaration =============================================
-- D-35 answer (C): the question is asked outright at join time, with no default either way. The
-- API layer is where that is enforced (the zod schema requires the field, so a join without an
-- answer is a 400); the column default exists only for the rows nobody is ever asked about --
-- guests named at close, and passengers the driver seats by hand (D-24).
alter table trip_rider
  add column if not exists wants_return boolean not null default false;

comment on column trip_rider.wants_return is
  'D-35: rider declared at join time that they are returning with this driver. Only meaningful on a round trip. The seat on the return leg is held until the outbound closes; declining frees it for everyone else at that moment, never before.';

-- === 3. join_trip() carries the answer ======================================
-- Signature change. The old two-argument version is KEPT for now, as a shim that delegates with
-- "not returning" -- see the bottom of this section for why, and for when to remove it.

create or replace function public.join_trip(p_trip_id uuid, p_profile_id uuid, p_wants_return boolean)
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
  select id, driver_id, status, capacity, depart_at, direction into v_trip
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

  -- A one-way trip has no return leg to declare for, so the answer is forced false there rather
  -- than trusted from the caller.
  insert into trip_rider (trip_id, profile_id, state, wants_return)
  values (p_trip_id, p_profile_id, 'joined', p_wants_return and v_trip.direction = 'round')
  returning * into v_rider;

  return v_rider;
end;
$$;

revoke execute on function public.join_trip(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.join_trip(uuid, uuid, boolean) to service_role;

-- DEPLOY SHIM -- REMOVE IN A LATER MIGRATION.
--
-- The instinct was to drop the two-argument version outright, so a caller that forgets the answer
-- fails loudly instead of silently defaulting to "not returning". That is right for application
-- code and wrong for a live database: the deployed app is whatever is on origin/main at the time
-- this migration runs, and it still calls join_trip(trip, profile). Dropping the old signature
-- makes every join on the live app fail from the instant the migration lands until the new build
-- is serving -- an outage whose length is however long a deploy takes, for no benefit.
--
-- So the old signature survives as a two-line delegation. It is not a default in disguise: nothing
-- in the new code path can reach it, because the API layer requires the answer in zod before it
-- ever gets here. It exists only for requests served by the previous build.
--
-- Remove it in the migration after the new build is live and confirmed. At that point a call to
-- the two-argument form genuinely is a bug, and should fail loudly again.
create or replace function public.join_trip(p_trip_id uuid, p_profile_id uuid)
returns trip_rider
language sql
security definer
set search_path = public
as $$
  select public.join_trip(p_trip_id, p_profile_id, false);
$$;

revoke execute on function public.join_trip(uuid, uuid) from public, anon, authenticated;
grant execute on function public.join_trip(uuid, uuid) to service_role;

-- === 4. the generator =======================================================
-- Called by every close path. Idempotent by construction: it locks the parent first, and the
-- unique index above is the backstop if two callers ever get past that check in the same instant.
--
-- The D-36 collision is handled here rather than left to the caller. If the driver has already
-- published a `back` trip by hand at the return hour, a naive insert would either duplicate the
-- ride or trip over a future same-hour constraint -- and the failure mode is a stranded return
-- leg, the exact thing this function exists to prevent. So it ADOPTS that trip instead.
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
  select id, group_id, driver_id, direction, return_at, capacity, back_stop_id
    into v_parent
  from trip
  where id = p_parent_trip_id
  for update;

  if not found then
    raise exception 'trip_not_found';
  end if;

  -- Only a round trip has a return leg to materialise. A one-way out or back is already whole.
  if v_parent.direction <> 'round' or v_parent.return_at is null then
    return null;
  end if;

  -- Already materialised: return it unchanged. This is the idempotency contract the four close
  -- paths rely on.
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
    -- D-35 answer (D): the back leg inherits the outbound's capacity and its D-29 return stop, and
    -- departs at the return time the driver set. The driver may move that time afterwards like any
    -- other trip of theirs -- "the driver is in charge and can do whatever it wants".
    insert into trip (group_id, driver_id, direction, depart_at, capacity, status, back_stop_id, parent_trip_id)
    values (v_parent.group_id, v_parent.driver_id, 'back', v_parent.return_at, v_parent.capacity,
            'scheduled', v_parent.back_stop_id, p_parent_trip_id)
    returning * into v_back;
  end if;

  select v_back.capacity - count(*) into v_seats_left
  from trip_rider
  where trip_id = v_back.id and state in ('joined', 'confirmed');

  -- Seat the riders who said they were coming back, oldest declaration first. Guests are skipped:
  -- a guest has no account to be notified on and no way to be asked the question in the first
  -- place. If an adopted trip has fewer free seats than declarations, the earliest joins win --
  -- the same first-come rule the capacity check has always used.
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
