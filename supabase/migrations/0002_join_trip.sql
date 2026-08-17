-- Phase 4 — transactional, capacity-checked trip join (02_IMPLEMENTATION_PLAN.md §4 Phase 4).
-- A plain "count active riders, then insert" from application code has a race window: two riders
-- can both read seatsLeft > 0 before either insert lands, both succeed, and the trip oversells.
-- This closes it with `select ... for update` — the trip row is locked for the duration of the
-- check + insert, so concurrent join_trip() calls for the same trip serialize instead of racing.
--
-- Only the service-role client calls this (D-04: writes always go through the admin client), so
-- EXECUTE is revoked from anon/authenticated/public — there is no client-facing path to it at all,
-- matching the audit_log table's "service_role only" precedent.

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
  select id, driver_id, status, capacity into v_trip
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
grant execute on function public.join_trip(uuid, uuid) to service_role;
