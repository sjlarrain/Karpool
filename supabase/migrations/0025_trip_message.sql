-- D-57 — an in-app thread per trip.
--
-- The developer, 2026-09-07: "Can we built a in app chat to tell important messages to the people
-- that is being pool. Example: I wait you here. I am here, etc."
--
-- Both examples are about ONE ride at ONE moment, which is what settles the shape. Asked to choose,
-- the developer picked one thread per trip over a group-wide room: on a group where three cars leave
-- the same morning, "I'm here" in a shared room tells nobody where, or whose car, or when.
--
-- Not a `kudos`-shaped table. Kudos is one row per rider per trip with a unique index enforcing it;
-- this is the opposite — many rows per person, ordered, and read as a sequence.

create table trip_message (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trip (id) on delete cascade,
  -- No guest column, deliberately. A guest (D-09/D-55) has no account, no device and no session, so
  -- there is nobody to attribute a message to or to notify. Their seat is still counted; they just
  -- do not talk here.
  profile_id uuid not null references profile (id) on delete cascade,
  -- 500 is a coordination message, not a conversation: "I'm at the north gate", "running 5 late".
  -- Enforced here as well as in zod so the column cannot be filled by any other path.
  body text not null check (length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

-- The only query this table has: one trip's thread, oldest first.
create index trip_message_by_trip on trip_message (trip_id, created_at);

alter table trip_message enable row level security;

-- Reads bounded to the caller's own groups, the same shape as trip_rider's policy and for the same
-- reason: RLS is defense-in-depth here (D-04), not the real gate. The real gate is in the API route,
-- which narrows further than this policy can cheaply express — to the driver and the people holding
-- a seat, so a group member who is not on the ride cannot read what was said on it.
--
-- Writes have no policy at all, like every other table in this schema: they go through the
-- service-role client from a route that has already checked the caller (D-04).
create policy trip_message_member_select on trip_message for select
using (exists (select 1 from trip where trip.id = trip_message.trip_id and is_member(trip.group_id)));

comment on table trip_message is
  'D-57: per-trip coordination thread. Driver + everyone holding a seat. Readable for the life of the trip; postable only while it is scheduled or started.';
