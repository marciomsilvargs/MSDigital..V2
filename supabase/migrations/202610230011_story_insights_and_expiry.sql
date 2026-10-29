-- Story performance snapshots and optional automatic removal.
alter table public.stories
  add column if not exists delete_at timestamptz,
  add column if not exists delete_status text not null default 'not_scheduled',
  add column if not exists delete_attempts integer not null default 0,
  add column if not exists deleted_at timestamptz,
  add column if not exists delete_error text;

create index if not exists stories_delete_queue_idx
  on public.stories(delete_at)
  where delete_at is not null and delete_status = 'scheduled';

create table if not exists public.story_insights (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  story_id uuid not null references public.stories(id) on delete cascade,
  captured_at timestamptz not null default now(),
  impressions integer,
  reach integer,
  replies integer,
  exits integer,
  taps_forward integer,
  taps_back integer,
  raw jsonb not null default '{}',
  unique(story_id, captured_at)
);

create index if not exists story_insights_company_captured_idx
  on public.story_insights(company_id, captured_at desc);
create index if not exists story_insights_story_idx
  on public.story_insights(story_id, captured_at desc);

alter table public.story_insights enable row level security;
create policy "company_members_manage_story_insights" on public.story_insights
  for all to authenticated using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

grant select, insert, update, delete on public.story_insights to authenticated;

