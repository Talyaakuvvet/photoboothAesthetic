-- Run once, after `supabase functions deploy cleanup`.
-- Replace PROJECT_REF and ANON_KEY with your values (Project Settings > API).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'booth-cleanup',
  '0 4 * * *',   -- every day at 04:00 UTC
  $$
  select net.http_post(
    url     := 'https://PROJECT_REF.supabase.co/functions/v1/cleanup',
    headers := jsonb_build_object('Authorization', 'Bearer ANON_KEY', 'Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);

-- To stop it later:  select cron.unschedule('booth-cleanup');
