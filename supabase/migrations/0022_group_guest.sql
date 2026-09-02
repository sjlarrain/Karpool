-- D-55: a durable identity for the people who ride without an account.
--
-- The developer: "We are having problem with people that is not register who is being pooled. I
-- need to add a sort of bots to take count and then merge them when the user register."
--
-- Until now a non-member existed only as free text typed into the close screen (D-09), so the same
-- colleague riding twice was two unrelated strings — nothing accumulated, and when they finally
-- signed up their history was unreachable. A guest is now a row: seats point at it, its rides add
-- up, and a group admin linking it to a member makes every seat it has *ever* held count for that
-- member. The merge is one UPDATE on one row, which also means it is reversible — re-pointing a
-- pile of trip_rider rows would not have been.
--
-- Deliberately NOT a profile row. profile.id is a foreign key to auth.users (0001), so a ghost
-- profile would mean minting fake accounts that then show up in the admin Users tab, count as
-- members, and can be sent notifications. A table of its own avoids all of that, and every
-- existing FK — points_ledger, membership, kudos — stays exactly as strict as it was.
--
-- No initials or avatar_color columns: initialsFor() and avatarColorFor() already derive both from
-- a name for entities with no profile, which is what guest riders have always used.

create table group_guest (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references "group" (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  -- Set when a group admin links this guest to a member. No `on delete set null`: clearing the
  -- claimant while claimed_at stood would break the pairing check below, and a profile holding
  -- points_ledger rows cannot be deleted anyway — same rule, stated the same way.
  claimed_by_profile_id uuid references profile (id),
  claimed_at timestamptz,
  claimed_by_admin_id uuid references profile (id),
  created_by uuid not null references profile (id),
  created_at timestamptz not null default now(),
  check ((claimed_by_profile_id is null) = (claimed_at is null))
);

-- The stable identity, and the whole point of the table: one "Maria" per group, however many
-- drivers type the name. Case- and space-insensitive, because "maria" and "Maria " are the same
-- colleague and a roster that lets them diverge counts nothing.
create unique index group_guest_name_per_group on group_guest (group_id, lower(trim(display_name)));

-- Deliberately NO unique index on claimed_by_profile_id. Two roster entries for one person
-- ("Maria", "Maria G") is exactly the mess this table exists to clean up, and both must be
-- linkable to the same member. Each seat is still counted once, so nothing is double-counted.
create index group_guest_claimed_by on group_guest (claimed_by_profile_id) where claimed_by_profile_id is not null;
create index group_guest_by_group on group_guest (group_id);

alter table group_guest enable row level security;

-- Reads only, and only inside the group — same shape as every other table here. Writes go through
-- the service-role client from an API route that has already checked the caller's role (D-04).
create policy group_guest_member_select on group_guest for select using (is_member(group_id));

-- ─── the seat's link to the roster ──────────────────────────────────────────
-- `on delete set null` is the safety net rather than the plan: the delete route refuses to remove a
-- guest that holds seats, but if one ever goes, the seats survive as plain named guests exactly as
-- they behaved before this migration — guest_name is stored on the seat, not looked up.
alter table trip_rider add column group_guest_id uuid references group_guest (id) on delete set null;

-- A seat is one person. The existing `profile_id is not null or guest_name is not null` check
-- already forces a roster seat to carry its name, since it has no profile.
alter table trip_rider add constraint trip_rider_guest_has_no_profile
  check (group_guest_id is null or profile_id is null);

-- The guest twin of trip_rider_one_active_seat, and the same partial shape: a roster guest can hold
-- one live seat on a trip. Guests typed at close are unaffected — they have no group_guest_id.
create unique index trip_rider_one_active_guest_seat
  on trip_rider (trip_id, group_guest_id)
  where state = 'joined' and group_guest_id is not null;

create index trip_rider_group_guest on trip_rider (group_guest_id) where group_guest_id is not null;

-- ─── seating a roster guest ─────────────────────────────────────────────────
-- The guest twin of add_trip_rider (0010), and the same reason for existing: the capacity check and
-- the insert must be one locked step, or a guest and a self-joining rider race for the last seat.
-- Differences from add_trip_rider: no membership requirement (a guest is by definition not a
-- member), and the guest must belong to the trip's own group.
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

  if v_trip.status not in ('scheduled', 'started') then
    raise exception 'wrong_status';
  end if;

  select id, group_id, display_name into v_guest
  from group_guest
  where id = p_group_guest_id;

  if not found then
    raise exception 'guest_not_found';
  end if;

  -- A guest belongs to one group. Seating another group's guest would leak a name across the
  -- boundary every other query in this schema defends.
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

  -- guest_name is denormalised onto the seat on purpose: every existing display path reads it, so
  -- none of them change, and the history keeps what the person was called at the time.
  insert into trip_rider (trip_id, group_guest_id, guest_name, state, added_by_profile_id)
  values (p_trip_id, p_group_guest_id, v_guest.display_name, 'joined', p_added_by)
  returning * into v_rider;

  return v_rider;
end;
$$;

revoke execute on function public.add_trip_guest(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.add_trip_guest(uuid, uuid, uuid) to service_role;
