-- D-21, second half: make the scheduler observable.
--
-- The reason a dead scheduler went unnoticed for weeks is that a scheduler doing nothing and a
-- scheduler that was never called look identical from the app: no reminders, no auto-closes, no
-- errors. /api/admin/health could only report cron *auto-closes*, which are also empty when
-- everything is healthy and no trip was abandoned.
--
-- This exposes the job itself — is it scheduled, is it active, when did it last run, did that run
-- succeed — so "the scheduler is dead" is a visible fact rather than an absence of evidence.
-- cron.job and cron.job_run_details are not reachable through PostgREST, hence the wrapper.

create or replace function public.carpool_cron_status()
returns table (
  jobname text,
  schedule text,
  active boolean,
  last_run_at timestamptz,
  last_status text
)
language sql
security definer
set search_path = public, cron
as $$
  select
    j.jobname::text,
    j.schedule::text,
    j.active,
    d.start_time,
    d.status::text
  from cron.job j
  left join lateral (
    select r.start_time, r.status
    from cron.job_run_details r
    where r.jobid = j.jobid
    order by r.start_time desc
    limit 1
  ) d on true
  where j.jobname = 'carpool-tick';
$$;

comment on function public.carpool_cron_status is
  'D-21: last-run health of the carpool-tick job, for GET /api/admin/health. Returns no rows if the job was never scheduled.';

revoke all on function public.carpool_cron_status() from public, anon, authenticated;
grant execute on function public.carpool_cron_status() to service_role;
