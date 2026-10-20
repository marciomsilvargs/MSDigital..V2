-- Initial PostgreSQL schema for MS Digital V2. Apply in Supabase SQL Editor.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '', email text not null default '', created_at timestamptz not null default now()
);
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(), name text not null, segment text not null default '',
  logo_url text not null default '', created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table if not exists public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(), primary key (company_id,user_id)
);
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text not null, role text not null default 'atendente', email text not null default '', created_at timestamptz not null default now()
);
create table if not exists public.connections (
  company_id uuid primary key references public.companies(id) on delete cascade, state text not null default 'not_connected',
  source text not null default '', provider text not null default 'meta_instagram', login_flow text not null default 'instagram_login',
  ig_user_id text not null default '', username text not null default '', profile_pic text not null default '', account_type text not null default '',
  granted_scopes text[] not null default '{}', enabled_features text[] not null default '{}', webhooks jsonb not null default '{}',
  token_expires_at timestamptz, last_synced_at timestamptz, last_error text, error_hint text, updated_at timestamptz not null default now()
);
create table if not exists public.media (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  media_type text not null default 'image', url text not null, storage_path text, name text not null default '', created_at timestamptz not null default now()
);
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  media_url text not null default '', media_storage_path text, media_type text not null default 'image', caption text not null default '', schedule_at timestamptz not null,
  status text not null default 'scheduled', attempts integer not null default 0, last_error text, execution text not null default '',
  platform_id text not null default '', published_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  contact_name text not null, contact_username text not null default '', avatar_color text not null default '#C5A46D',
  status text not null default 'open', assignee text not null default '', tags text[] not null default '{}', notes jsonb not null default '[]',
  unread integer not null default 0, last_message_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade, direction text not null default 'in',
  text text not null, source text not null default 'demo', created_at timestamptz not null default now()
);
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  post_id text not null default '', post_caption text not null default '', author text not null, text text not null,
  status text not null default 'new', reply_text text, replied_at timestamptz, reply_source text not null default '',
  source text not null default 'demo', created_at timestamptz not null default now()
);
create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  name text not null, description text not null default '', enabled boolean not null default true, nodes jsonb not null default '[]',
  edges jsonb not null default '[]', runs integer not null default 0, last_run_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  automation_id uuid, automation_name text not null default '', trigger text not null default '', matched_text text not null default '',
  result text not null default 'executed', detail text not null default '', source text not null default 'demo', created_at timestamptz not null default now()
);
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  title text not null, source text not null default 'demo', done boolean not null default false, created_at timestamptz not null default now()
);

create index if not exists employees_company_idx on public.employees(company_id);
create index if not exists stories_company_schedule_idx on public.stories(company_id,schedule_at desc);
create index if not exists conversations_company_last_message_idx on public.conversations(company_id,last_message_at desc);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id,created_at);
create index if not exists comments_company_created_idx on public.comments(company_id,created_at desc);
create index if not exists automations_company_idx on public.automations(company_id);
create index if not exists automation_runs_company_created_idx on public.automation_runs(company_id,created_at desc);
create index if not exists tasks_company_created_idx on public.tasks(company_id,created_at desc);

create or replace function public.is_company_member(target_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.company_members m where m.company_id = target_company and m.user_id = (select auth.uid()));
$$;
revoke all on function public.is_company_member(uuid) from public;
grant execute on function public.is_company_member(uuid) to authenticated;

create or replace function public.is_company_admin(target_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.company_members m where m.company_id = target_company and m.user_id = (select auth.uid()) and m.role in ('owner','admin'));
$$;
revoke all on function public.is_company_admin(uuid) from public;
grant execute on function public.is_company_admin(uuid) to authenticated;

create or replace function public.add_company_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.company_members(company_id,user_id,role) values (new.id,new.created_by,'owner');
  return new;
end;
$$;
drop trigger if exists on_company_created_add_owner on public.companies;
create trigger on_company_created_add_owner after insert on public.companies for each row execute procedure public.add_company_owner();

create or replace function public.bootstrap_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,name,email) values (new.id,coalesce(new.raw_user_meta_data ->> 'name',''),coalesce(new.email,''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users for each row execute procedure public.bootstrap_profile();
insert into public.profiles(id,name,email)
select id,coalesce(raw_user_meta_data ->> 'name',''),coalesce(email,'') from auth.users
on conflict (id) do update set email = excluded.email;

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.employees enable row level security;
alter table public.connections enable row level security;
alter table public.media enable row level security;
alter table public.stories enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.comments enable row level security;
alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;
alter table public.tasks enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profile_select_self') then
    create policy "profile_select_self" on public.profiles for select to authenticated using (id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='profile_update_self') then
    create policy "profile_update_self" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='companies' and policyname='companies_read_members') then
    create policy "companies_read_members" on public.companies for select to authenticated using (public.is_company_member(id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='companies' and policyname='companies_create_self') then
    create policy "companies_create_self" on public.companies for insert to authenticated with check (created_by = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='companies' and policyname='companies_update_admin') then
    create policy "companies_update_admin" on public.companies for update to authenticated using (public.is_company_admin(id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='companies' and policyname='companies_delete_admin') then
    create policy "companies_delete_admin" on public.companies for delete to authenticated using (public.is_company_admin(id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='company_members' and policyname='company_members_read_self_or_company_admin') then
    create policy "company_members_read_self_or_company_admin" on public.company_members for select to authenticated using (user_id = (select auth.uid()) or public.is_company_admin(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='company_members' and policyname='company_members_add_by_company_admin') then
    create policy "company_members_add_by_company_admin" on public.company_members for insert to authenticated with check (public.is_company_admin(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='company_members' and policyname='company_members_remove_by_company_admin') then
    create policy "company_members_remove_by_company_admin" on public.company_members for delete to authenticated using (public.is_company_admin(company_id));
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['employees','connections','media','stories','conversations','messages','comments','automations','automation_runs','tasks'] loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=format('company_member_all_%s', t)) then
      execute format('create policy "company_member_all_%1$s" on public.%1$I for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id))', t);
    end if;
  end loop;
end $$;

grant select,insert,update on public.profiles to authenticated;
grant select,insert,update,delete on public.companies,public.company_members,public.employees,public.connections,public.media,
  public.stories,public.conversations,public.messages,public.comments,public.automations,public.automation_runs,public.tasks to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('media','media',false,3000000,array['image/*','video/*'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='company_members_read_media') then
    create policy "company_members_read_media" on storage.objects for select to authenticated using (bucket_id = 'media' and public.is_company_member(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='company_members_upload_media') then
    create policy "company_members_upload_media" on storage.objects for insert to authenticated with check (bucket_id = 'media' and public.is_company_member(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='company_members_update_media') then
    create policy "company_members_update_media" on storage.objects for update to authenticated using (bucket_id = 'media' and public.is_company_member(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='company_members_delete_media') then
    create policy "company_members_delete_media" on storage.objects for delete to authenticated using (bucket_id = 'media' and public.is_company_member(((storage.foldername(name))[1])::uuid));
  end if;
end $$;
