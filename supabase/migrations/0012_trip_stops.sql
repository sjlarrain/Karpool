-- D-29 (trip stopovers). A trip may detour through one named place per leg — the group's gym,
-- pool or shop — and the card shows it as a sign inside the route line.
--
-- Two shapes, deliberately separate:
--
-- 1. pickup_place gains a `kind`. The table already models "a named place this group uses, managed
--    by the group admin", which is exactly what a stop is — and its POST route is already
--    group_admin-only, which is the developer's requirement that the list stay manager-managed.
--    Reusing it means no new table, RLS, API or admin editor. `kind` is what keeps the two lists
--    apart so nobody can pick "Gym" as their home pickup point.
-- 2. `icon` is a fixed vocabulary, not free text. The sign has to be recognisable at a glance, and
--    a drawn icon renders identically on every phone where an emoji would not.
--
-- A stop is always mid-leg: the group owns the route and its endpoints never change. A ride that
-- *ends* somewhere else is a different destination, not a stop, and is out of scope here.

alter table pickup_place
  add column if not exists kind text not null default 'pickup'
    check (kind in ('pickup', 'stop'));

alter table pickup_place
  add column if not exists icon text
    check (icon in ('gym', 'pool', 'run', 'sport', 'shop', 'coffee', 'school', 'medical'));

-- An icon belongs to a stop and only to a stop: a stop without one has no sign to show, and a
-- pickup point never renders one.
alter table pickup_place
  drop constraint if exists pickup_place_icon_matches_kind;
alter table pickup_place
  add constraint pickup_place_icon_matches_kind
    check ((kind = 'stop') = (icon is not null));

comment on column pickup_place.kind is
  'D-29: ''pickup'' = where a member is collected along the route; ''stop'' = a place the whole car detours through mid-leg. The pickup dropdowns filter to ''pickup''.';
comment on column pickup_place.icon is
  'D-29: fixed vocabulary, not free text — the sign must render identically on every device. Non-null exactly when kind = ''stop''.';

-- ─── the stop on each leg ──────────────────────────────────────────────────
-- Two columns rather than a trip_stop join table: at most one stop per leg, which the schema can
-- then enforce by itself with no ordering UI and nothing to overpopulate.
--
-- on delete set null mirrors membership.pickup_place_id — deleting a place the group no longer uses
-- must not be blocked by, or destroy, the trips that once passed through it.
alter table trip
  add column if not exists out_stop_id uuid references pickup_place (id) on delete set null;
alter table trip
  add column if not exists back_stop_id uuid references pickup_place (id) on delete set null;

-- Same idiom as the existing `check (return_at is null or direction = 'round')`: a leg that the
-- trip does not travel cannot carry a stop.
alter table trip drop constraint if exists trip_out_stop_direction;
alter table trip
  add constraint trip_out_stop_direction
    check (out_stop_id is null or direction in ('out', 'round'));

alter table trip drop constraint if exists trip_back_stop_direction;
alter table trip
  add constraint trip_back_stop_direction
    check (back_stop_id is null or direction in ('back', 'round'));

comment on column trip.out_stop_id is
  'D-29: stop on the outbound leg (origin -> [stop] -> destination). Null for none. Group/kind membership is validated in the API, which is the only writer.';
comment on column trip.back_stop_id is
  'D-29: stop on the return leg (destination -> [stop] -> origin). Only meaningful for direction ''back'' or ''round''.';
