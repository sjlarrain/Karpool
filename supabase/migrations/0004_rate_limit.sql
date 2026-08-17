-- Phase 9 — rate limiting on join/create/kudos. Postgres-backed rather than in-memory: Vercel
-- serverless functions don't share memory across instances or survive cold starts, so an
-- in-memory counter wouldn't actually limit anything in production. No policies (service-role
-- only), same pattern as every other write path (D-04).

create table rate_limit_hit (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profile (id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_hit_lookup_idx on rate_limit_hit (profile_id, action, created_at);

alter table rate_limit_hit enable row level security;
