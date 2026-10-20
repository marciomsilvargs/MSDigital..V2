-- The Stories scheduler calls the deployed cron-stories Edge Function over
-- HTTP. Keep the transport extension in migrations; the job itself is created
-- in Supabase Cron so its x-cron-secret remains encrypted and outside Git.
create extension if not exists pg_net with schema extensions;

comment on extension pg_net is
  'Asynchronous HTTP transport used by the msdigital-stories-every-minute job';
