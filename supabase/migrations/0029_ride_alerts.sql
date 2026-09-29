-- D-64 (developer, 2026-09-28): "tell me when there's a ride at my usual time". A person opts in
-- (off by default), sets their usual to-work and back-home time per workday, and chooses how
-- flexible they are. When a ride with free seats is published inside that window, in any of their
-- groups, they get one notification. The matching is pure (src/domain/rideAlerts.ts); this only
-- stores the settings.
--
-- One row per person, created the first time they save. No row means alerts are off.
create table if not exists ride_alert (
  profile_id uuid primary key references profile (id) on delete cascade,
  enabled boolean not null default false,
  slack_minutes int not null default 30 check (slack_minutes in (15, 30, 60)),
  -- The zone their times were written in, stamped by the server on save.
  time_zone text not null,
  -- { "mon": { "out": "07:30" | null, "back": "17:30" | null }, ... "fri": {...} }, validated by the
  -- API's zod schema before it is written.
  days jsonb not null,
  updated_at timestamptz not null default now()
);

alter table ride_alert enable row level security;

-- Your own settings only. The sender reads everyone's through the service role.
create policy ride_alert_own_select on ride_alert for select using (profile_id = auth.uid());
create policy ride_alert_own_insert on ride_alert for insert with check (profile_id = auth.uid());
create policy ride_alert_own_update on ride_alert for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- A new notification type for the alert itself, so the bell and the push can say what it is.
alter table notification drop constraint if exists notification_type_check;
alter table notification add constraint notification_type_check
  check (type in ('start', 'rate', 'change', 'comment', 'tip', 'reminder', 'close_reminder', 'join', 'leave',
                  'parking', 'alert'));
