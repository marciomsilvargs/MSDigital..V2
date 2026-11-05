alter table public.stories
  add column if not exists processing_started_at timestamptz;

create index if not exists stories_publishing_timeout_idx
  on public.stories (status, processing_started_at)
  where status = 'publishing';
