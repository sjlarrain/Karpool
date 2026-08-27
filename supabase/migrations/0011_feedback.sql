-- D-25: in-app feedback. Stored in Postgres and read from the admin console — deliberately not
-- emailed, because the project still has no custom SMTP (D-22) and feedback that depends on mail
-- delivery is feedback that silently doesn't arrive.
--
-- profile_id and group_id are `on delete set null`: a deleted account must not take its feedback
-- with it, or the record of a complaint disappears with the person who made it.

create table feedback (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references profile (id) on delete set null,
  group_id uuid references "group" (id) on delete set null,
  category text not null check (category in ('bug', 'idea', 'praise', 'other')),
  message text not null check (char_length(message) between 1 and 2000),
  -- What the sender was running. A bug report without this is usually unactionable.
  user_agent text,
  created_at timestamptz not null default now()
);

create index feedback_created_at_idx on feedback (created_at desc);

alter table feedback enable row level security;

-- Writes go through the service-role client (D-04), the same as every other table. The only
-- client-facing policy is the sender reading their own submissions back.
create policy feedback_self_select on feedback for select
using (profile_id = auth.uid());
