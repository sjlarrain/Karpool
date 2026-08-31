-- D-35 follow-up: remove the two-argument join_trip deploy shim.
--
-- 0013 changed join_trip's signature to carry the rider's return answer, and kept the old
-- two-argument form as a delegation passing false. That shim existed for exactly one reason: the
-- build serving production at migration time was the previous one, which still called the old
-- signature, and dropping it would have failed every join between the migration landing and the
-- new build going out.
--
-- That window is closed. The new build is live and confirmed -- the join sheet asks the return
-- question -- so nothing calls the two-argument form any more. Keeping it past its purpose is worse
-- than useless: it is a silent default sitting behind a function whose whole point is that the
-- answer must be explicit. Any future caller reaching it would get "not returning" without ever
-- having asked, which is the failure mode D-35 answer (C) was written to prevent.
--
-- Dropping it restores the original intent: a caller that forgets the answer fails loudly.
--
-- Only the two-argument overload is dropped. The three-argument function -- the real one, which the
-- application calls -- is untouched, along with its grants.

drop function if exists public.join_trip(uuid, uuid);
