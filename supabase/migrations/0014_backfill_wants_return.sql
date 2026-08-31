-- D-35 follow-up: backfill wants_return for riders who joined before the question existed.
--
-- 0013 added trip_rider.wants_return with `default false`, which is right for every row written
-- after it -- the API requires an explicit answer, so false there means "asked, and said no". It is
-- wrong for every row written BEFORE it. Those riders were never asked, and false silently
-- reassigns what they had already booked.
--
-- Under the pre-D-35 model a round trip was one row covering both departures, so joining it held
-- the return seat too. D-30 states exactly that as the problem it was opening: "a round trip
-- carries one capacity and trip_rider has no leg, so a rider who only travels out still holds the
-- return seat". Whatever else was wrong with that shape, it is what these riders signed up for.
--
-- Left at false, the consequence is not cosmetic: when the driver closes the outbound,
-- generate_back_trip() seats only riders with wants_return, so a car that went out full comes back
-- empty, and the people in it lose their ride home with no notification and no card -- the exact
-- failure D-35 exists to prevent, delivered to the users who predate it.
--
-- Scope is deliberately narrow:
--   * direction = 'round' only. A one-way trip has no return leg to declare for, and 0013's
--     join_trip() forces false there; setting it true would be meaningless at best.
--   * status in ('scheduled','started') only. A closed or cancelled trip is history: its close
--     already happened, generate_back_trip() will not run for it again, and rewriting settled rows
--     would change the record of what occurred for no operational gain.
--   * active riders only. A 'left' or 'no_show' row describes someone who is not travelling.
--
-- Idempotent: re-running sets the same rows to the same value. Rows written after the deploy are
-- unaffected -- they belong to trips created after this ran, or already carry a real answer.

update trip_rider tr
set wants_return = true
from trip t
where tr.trip_id = t.id
  and t.direction = 'round'
  and t.status in ('scheduled', 'started')
  and tr.state in ('joined', 'confirmed')
  and tr.profile_id is not null
  and tr.wants_return = false;

-- Guests are excluded above and stay false on purpose: generate_back_trip() skips them regardless
-- (a guest has no account to be seated on the return leg or notified about it), so flipping the
-- flag would claim an intent the system cannot act on.
