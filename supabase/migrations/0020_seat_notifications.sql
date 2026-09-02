-- Adds "join" and "leave" to notification.type — the driver is now told when a rider takes a seat
-- on their trip and when one gives it back. Until now the join and leave routes notified nobody at
-- all, so a driver learned that their car had filled up (or emptied) only by opening the app and
-- looking.
--
-- Two types rather than one, and neither reuses "change", for the same reason 0017 gave: the bell
-- tints and icons a row by its type, so a kind of news that reads differently needs a value of its
-- own. A seat taken is good news and a seat freed is a heads-up; folding them into "change" would
-- put both under the amber "something about the schedule needs your attention" tile alongside a
-- cancellation.
--
-- Unlike the reminders, these need no dedupe: every join is a distinct event, and a rider who
-- leaves and rejoins has genuinely done two things the driver wants to know about.

alter table notification drop constraint if exists notification_type_check;
alter table notification add constraint notification_type_check
  check (type in ('start', 'rate', 'change', 'comment', 'tip', 'reminder', 'close_reminder', 'join', 'leave'));
