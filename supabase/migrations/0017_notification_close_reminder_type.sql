-- Adds "close_reminder" to notification.type — the nudge sent to a driver whose trip is still
-- sitting in `started` long after it left, so the ride gets closed and everyone is actually paid.
--
-- It needs a type of its own rather than reusing "reminder". The scheduler dedupes a trip's
-- reminder by looking for an existing row of that type carrying the trip's id, so a departure
-- reminder and a close reminder sharing one type would suppress each other: whichever fired first
-- would make the second look already-sent, for the same trip, forever.

alter table notification drop constraint if exists notification_type_check;
alter table notification add constraint notification_type_check
  check (type in ('start', 'rate', 'change', 'comment', 'tip', 'reminder', 'close_reminder'));
