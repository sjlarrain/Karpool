-- D-61 follow-up (developer, 2026-09-19: "it needs to appear twice"). The what's-new sheet was
-- built to show once, closed for good the moment `seen_announcement` matched the current key. This
-- adds a counter so the SAME key is shown up to ANNOUNCEMENT_MAX_VIEWS times (src/domain/announcement.ts)
-- before it stops, rather than the first dismissal ending it.

alter table profile add column if not exists announcement_seen_count int not null default 0
  check (announcement_seen_count >= 0);
comment on column profile.announcement_seen_count is
  'D-61: how many times the CURRENT profile.seen_announcement key has been shown and dismissed. Reset to 0 implicitly whenever seen_announcement changes to a new key.';
