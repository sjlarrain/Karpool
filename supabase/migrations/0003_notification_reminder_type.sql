-- Phase 5 — adds "reminder" to notification.type. The original five types (start/rate/change/
-- comment/tip) came verbatim from the sketch's mock notification list (docs/Carpool App.dc.html),
-- which never included a departure-reminder example. "start" already means "the trip has actually
-- started" (POST /api/trips/:id/start); the cron departure reminder ("trip leaves in 15 minutes")
-- needs a distinct type so the two aren't conflated.

alter table notification drop constraint if exists notification_type_check;
alter table notification add constraint notification_type_check
  check (type in ('start', 'rate', 'change', 'comment', 'tip', 'reminder'));
