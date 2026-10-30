-- Lead records created by official Instagram events and automations.
-- Every lead is isolated by company and deduplicated by the platform identity.
create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  social_network text not null default 'instagram',
  social_user_id text not null default '',
  public_name text not null default '',
  username text not null default '',
  source text not null default 'instagram',
  interest_type text not null default 'association',
  interested_plan text not null default '',
  stage text not null default 'new' check (stage in ('new','interested','qualified','sales','converted','closed')),
  first_interaction_at timestamptz not null default now(),
  last_interaction_at timestamptz not null default now(),
  last_conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists crm_leads_company_social_identity_idx
  on public.crm_leads(company_id, social_network, social_user_id)
  where social_user_id <> '';
create index if not exists crm_leads_company_stage_idx
  on public.crm_leads(company_id, stage, last_interaction_at desc);

alter table public.crm_leads enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='crm_leads' and policyname='company_members_manage_crm_leads') then
    create policy "company_members_manage_crm_leads" on public.crm_leads
      for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
  end if;
end $$;
grant select, insert, update, delete on public.crm_leads to authenticated;

alter table public.comments add column if not exists author_platform_id text not null default '';
create index if not exists comments_company_author_platform_idx
  on public.comments(company_id, author_platform_id)
  where author_platform_id <> '';
