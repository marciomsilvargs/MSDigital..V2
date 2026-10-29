-- Retry automatic Story deletion after transient Meta/token failures.
alter table public.stories
  add column if not exists delete_attempts integer not null default 0;

