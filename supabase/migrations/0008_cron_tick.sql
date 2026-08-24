-- D-21 — the scheduler (developer, 2026-08-24: Supabase pg_cron + pg_net).
--
-- Vercel Cron was removed (the free plan won't run a 5-minute schedule), which left
-- /api/cron/tick with no caller: T-15min departure reminders and the 6h auto-close of abandoned
-- `started` trips simply never ran. This puts the schedule inside the database instead — pg_cron
-- fires every 5 minutes and pg_net makes the HTTP call. Both extensions ship with Supabase on every
-- plan and run inside this project's own Postgres, so no new service enters the infrastructure
-- plan's list and nothing is metered per invocation.
--
-- Neither the URL nor the secret is written here: they live in Supabase Vault, encrypted, and the
-- job reads them at call time. That keeps CRON_SECRET out of every tracked file (CLAUDE.md §2.6)
-- and lets the developer repoint the job at a new domain without a migration. Set them once:
--
--   select vault.create_secret('https://your-domain/api/cron/tick', 'carpool_tick_url');
--   select vault.create_secret('<the CRON_SECRET value>',           'carpool_cron_secret');
--
-- Until both exist the job runs, finds nothing to call, and does nothing — see the guard below.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- One place that knows how to call the tick endpoint. SECURITY DEFINER because cron runs the job as
-- the job owner and Vault is not readable by anyone else; the function returns nothing a caller
-- could mine for the secret.
create or replace function public.carpool_cron_tick()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  tick_url text;
  tick_secret text;
begin
  select decrypted_secret into tick_url from vault.decrypted_secrets where name = 'carpool_tick_url';
  select decrypted_secret into tick_secret from vault.decrypted_secrets where name = 'carpool_cron_secret';

  -- Not configured yet (or someone rotated a secret away): stay quiet rather than firing an
  -- unauthenticated request at an unknown URL every five minutes.
  if tick_url is null or tick_secret is null then
    return;
  end if;

  perform net.http_post(
    url := tick_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || tick_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
end;
$$;

comment on function public.carpool_cron_tick is
  'D-21: calls /api/cron/tick with the CRON_SECRET. URL and secret come from Vault (carpool_tick_url, carpool_cron_secret), never from this file.';

revoke all on function public.carpool_cron_tick() from public, anon, authenticated;

-- Idempotent: unschedule first so re-running the migration doesn't stack duplicate jobs.
select cron.unschedule('carpool-tick') where exists (select 1 from cron.job where jobname = 'carpool-tick');

select cron.schedule('carpool-tick', '*/5 * * * *', 'select public.carpool_cron_tick()');
