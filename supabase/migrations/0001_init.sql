-- Phase 1 — schema, per 02_IMPLEMENTATION_PLAN.md §4.
-- D-04 (server-side only), D-09 (guest riders = name-only), D-10/D-11 (per-group configurable
-- penalty/weights), D-13 (no email-domain restriction) are already reflected in this shape.

create extension if not exists pgcrypto;

-- ─── profile ──────────────────────────────────────────────────────────────
create table profile (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  initials text not null,
  avatar_color text not null,
  platform_role text not null default 'member' check (platform_role in ('member', 'platform_admin')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─── group ────────────────────────────────────────────────────────────────
-- Quoted throughout: "group" is a reserved word.
create table "group" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  origin_label text not null,
  dest_label text not null,
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'), -- GROUP_CODE_LENGTH (src/domain/constants.ts)
  cost_split_note text, -- D-08: static per-group text, not computed
  drive_weight int not null default 10, -- D-11: per-group, default matches POINTS.drive
  pool_weight int not null default 3,
  kudos_weight int not null default 2,
  late_window_minutes int not null default 60, -- D-10: per-group, default matches LATE_LEAVE
  late_penalty int not null default -5,
  created_by uuid not null references profile (id),
  created_at timestamptz not null default now()
);

-- ─── pickup_place ─────────────────────────────────────────────────────────
create table pickup_place (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references "group" (id) on delete cascade,
  label text not null,
  address text not null,
  typical_time text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ─── membership ───────────────────────────────────────────────────────────
create table membership (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references "group" (id) on delete cascade,
  profile_id uuid not null references profile (id) on delete cascade,
  group_role text not null default 'member' check (group_role in ('member', 'group_admin')),
  pickup_place_id uuid references pickup_place (id) on delete set null,
  joined_at timestamptz not null default now(),
  unique (group_id, profile_id)
);

-- ─── trip ─────────────────────────────────────────────────────────────────
create table trip (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references "group" (id) on delete cascade,
  driver_id uuid not null references profile (id),
  direction text not null check (direction in ('out', 'back', 'round')),
  depart_at timestamptz not null,
  return_at timestamptz,
  capacity int not null check (capacity between 1 and 7), -- SEATS.min/max
  status text not null default 'scheduled'
    check (status in ('scheduled', 'started', 'closed', 'cancelled')),
  started_at timestamptz,
  closed_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now(),
  check (return_at is null or direction = 'round')
);

-- ─── trip_rider ───────────────────────────────────────────────────────────
create table trip_rider (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trip (id) on delete cascade,
  profile_id uuid references profile (id) on delete cascade, -- null for guests
  guest_name text, -- D-09: name-only, no account
  pickup_place_id uuid references pickup_place (id),
  stop_order int,
  state text not null default 'joined'
    check (state in ('joined', 'left', 'confirmed', 'no_show')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  check (profile_id is not null or guest_name is not null)
);

-- A registered rider can only hold one active ("joined") seat per trip. Guests aren't covered —
-- guest_name has no identity to dedupe against.
create unique index trip_rider_one_active_seat
  on trip_rider (trip_id, profile_id)
  where state = 'joined' and profile_id is not null;

-- ─── kudos ────────────────────────────────────────────────────────────────
create table kudos (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trip (id) on delete cascade,
  from_profile_id uuid not null references profile (id),
  to_profile_id uuid not null references profile (id),
  comment text,
  created_at timestamptz not null default now(),
  unique (trip_id, from_profile_id)
);

-- ─── points_ledger (append-only) ───────────────────────────────────────────
create table points_ledger (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profile (id),
  group_id uuid not null references "group" (id),
  trip_id uuid references trip (id),
  kind text not null check (kind in ('drive', 'pool', 'kudos', 'late_leave', 'admin_adjust')),
  points int not null check (points <> 0),
  reason text,
  created_at timestamptz not null default now()
);

-- ─── notification ─────────────────────────────────────────────────────────
create table notification (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profile (id) on delete cascade,
  type text not null check (type in ('start', 'rate', 'change', 'comment', 'tip')),
  title text not null,
  body text,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ─── push_subscription ────────────────────────────────────────────────────
create table push_subscription (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profile (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  last_success_at timestamptz,
  failure_count int not null default 0,
  created_at timestamptz not null default now()
);

-- ─── audit_log (append-only) ───────────────────────────────────────────────
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references profile (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

-- ─── profile auto-creation ──────────────────────────────────────────────────
create function public.compute_initials(full_name text)
returns text
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  if full_name is null or trim(full_name) = '' then
    return '?';
  end if;
  parts := regexp_split_to_array(trim(full_name), '\s+');
  if array_length(parts, 1) = 1 then
    return upper(left(parts[1], 2));
  end if;
  return upper(left(parts[1], 1) || left(parts[array_length(parts, 1)], 1));
end;
$$;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen_name text;
begin
  chosen_name := coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1));
  insert into public.profile (id, display_name, initials, avatar_color)
  values (new.id, chosen_name, public.compute_initials(chosen_name), '#7c5cff');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- D-04: all data access goes through Vercel API routes. Writes use a service-role client
-- (service_role bypasses RLS by design), authorized in application code — so no table gets an
-- INSERT/UPDATE/DELETE policy for the `authenticated` role here. RLS's job is to bound SELECT to
-- a caller's own groups, as defense-in-depth for any route that queries with the user's own
-- session-scoped client rather than the service-role client.

create function public.is_member(p_group_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from membership
    where group_id = p_group_id and profile_id = auth.uid()
  );
$$;

alter table profile enable row level security;
alter table "group" enable row level security;
alter table pickup_place enable row level security;
alter table membership enable row level security;
alter table trip enable row level security;
alter table trip_rider enable row level security;
alter table kudos enable row level security;
alter table points_ledger enable row level security;
alter table notification enable row level security;
alter table push_subscription enable row level security;
alter table audit_log enable row level security;

-- A caller can see their own profile, plus profiles of anyone sharing a group with them (needed to
-- render driver/rider names).
create policy profile_self_or_groupmate_select on profile for select
using (
  id = auth.uid()
  or exists (
    select 1 from membership m1
    join membership m2 on m1.group_id = m2.group_id
    where m1.profile_id = auth.uid() and m2.profile_id = profile.id
  )
);

create policy group_member_select on "group" for select
using (is_member(id));

create policy pickup_place_member_select on pickup_place for select
using (is_member(group_id));

create policy membership_member_select on membership for select
using (is_member(group_id));

create policy trip_member_select on trip for select
using (is_member(group_id));

create policy trip_rider_member_select on trip_rider for select
using (exists (select 1 from trip where trip.id = trip_rider.trip_id and is_member(trip.group_id)));

create policy kudos_member_select on kudos for select
using (exists (select 1 from trip where trip.id = kudos.trip_id and is_member(trip.group_id)));

create policy points_ledger_member_select on points_ledger for select
using (is_member(group_id));

create policy notification_own_select on notification for select
using (profile_id = auth.uid());

create policy push_subscription_own_select on push_subscription for select
using (profile_id = auth.uid());

-- audit_log: intentionally zero policies. Only the service role (which bypasses RLS entirely) can
-- read or write it; the platform-admin API route re-checks the caller's role before using that
-- client (G9/G10), so this table has no client-facing path at all, read or write.
