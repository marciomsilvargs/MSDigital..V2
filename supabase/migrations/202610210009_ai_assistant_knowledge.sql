-- Per-company AI assistant configuration and versioned knowledge base.
create table if not exists public.ai_assistants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  name text not null default 'Assistente da empresa',
  personality text not null default 'Atencioso, claro e objetivo.',
  mode text not null default 'supervised' check (mode in ('automatic','supervised','assisted')),
  enabled boolean not null default false,
  human_handoff_enabled boolean not null default true,
  handoff_message text not null default 'Vou encaminhar você para nossa equipe.',
  active_knowledge_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies(id) on delete cascade,
  name text not null default 'Base principal',
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  knowledge_base_id uuid not null references public.knowledge_bases(id) on delete cascade,
  version_number integer not null default 1,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (knowledge_base_id, version_number),
  unique (id, company_id)
);

alter table public.ai_assistants
  drop constraint if exists ai_assistants_active_version_fk;
alter table public.ai_assistants
  add constraint ai_assistants_active_version_fk
  foreign key (active_knowledge_version_id, company_id)
  references public.knowledge_versions(id, company_id) on delete set null;

create table if not exists public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  knowledge_version_id uuid not null references public.knowledge_versions(id) on delete cascade,
  kind text not null default 'faq' check (kind in ('institutional','hours','service','course','event','price','promotion','faq','document')),
  title text not null,
  content text not null default '',
  metadata jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_entries_title_not_blank check (length(trim(title)) > 0)
);

create index if not exists knowledge_versions_company_idx on public.knowledge_versions(company_id, created_at desc);
create index if not exists knowledge_entries_version_idx on public.knowledge_entries(company_id, knowledge_version_id, kind, created_at desc);

alter table public.ai_assistants enable row level security;
alter table public.knowledge_bases enable row level security;
alter table public.knowledge_versions enable row level security;
alter table public.knowledge_entries enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ai_assistants' and policyname='company_members_manage_ai_assistants') then
    create policy "company_members_manage_ai_assistants" on public.ai_assistants for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='knowledge_bases' and policyname='company_members_manage_knowledge_bases') then
    create policy "company_members_manage_knowledge_bases" on public.knowledge_bases for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='knowledge_versions' and policyname='company_members_manage_knowledge_versions') then
    create policy "company_members_manage_knowledge_versions" on public.knowledge_versions for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='knowledge_entries' and policyname='company_members_manage_knowledge_entries') then
    create policy "company_members_manage_knowledge_entries" on public.knowledge_entries for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
  end if;
end $$;

grant select, insert, update, delete on public.ai_assistants, public.knowledge_bases, public.knowledge_versions, public.knowledge_entries to authenticated;

