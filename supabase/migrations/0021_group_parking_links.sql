-- D-54: where a driver pays for parking, per direction of travel.
--
-- The developer: "in the close trip button or when we travel in a certain direction, there is
-- payment parking links." Two optional columns on the group rather than a settings table, because
-- the group already owns the route and parking is a fact about that route's *endpoints* — which is
-- also why this does not belong on pickup_place: 0012 states that a stop is always mid-leg.
--
-- Per direction and both nullable, as chosen. A commute usually pays at one end only, so a group
-- with an office car park and free parking at home fills in `out` and leaves `back` empty; a trip
-- whose leg has no link simply shows nothing.
--
-- The https CHECK is not decoration. This is the first outbound link the app has ever rendered, and
-- the column is written by a group admin and then followed by their colleagues — so the scheme is
-- constrained in the database as well as in zod, closing javascript: and data: URLs at the layer
-- that cannot be bypassed by a future caller.

alter table "group"
  add column parking_url_out text,
  add column parking_url_back text;

alter table "group"
  add constraint group_parking_url_out_https
    check (parking_url_out is null or parking_url_out ~ '^https://'),
  add constraint group_parking_url_back_https
    check (parking_url_back is null or parking_url_back ~ '^https://');
