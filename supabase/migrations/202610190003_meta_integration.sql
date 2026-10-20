-- Private server-side state required by Meta OAuth and webhook processing.
-- Browser roles have no grants or policies for token material and OAuth state.
create table if not exists public.connection_secrets (
  company_id uuid primary key references public.companies(id) on delete cascade,
  token_ciphertext text not null,
  page_id text not null default '',
  page_name text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.oauth_states (
  state text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  flow text not null check (flow in ('instagram_login','facebook_login')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists oauth_states_expiry_idx on public.oauth_states(expires_at);

create table if not exists public.oauth_pending (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  pages jsonb not null default '[]',
  granted_scopes text[] not null default '{}',
  expires_in integer not null default 5184000,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now()
);
create index if not exists oauth_pending_expiry_idx on public.oauth_pending(expires_at);

create table if not exists public.webhook_events (
  event_id text primary key,
  created_at timestamptz not null default now()
);
create index if not exists webhook_events_created_idx on public.webhook_events(created_at);

alter table public.connection_secrets enable row level security;
alter table public.oauth_states enable row level security;
alter table public.oauth_pending enable row level security;
alter table public.webhook_events enable row level security;
revoke all on public.connection_secrets, public.oauth_states, public.oauth_pending, public.webhook_events from anon, authenticated;
grant all on public.connection_secrets, public.oauth_states, public.oauth_pending, public.webhook_events to service_role;

alter table public.conversations add column if not exists platform_scoped_id text not null default '';
alter table public.messages add column if not exists platform_message_id text not null default '';
alter table public.comments add column if not exists platform_comment_id text not null default '';
create unique index if not exists conversations_platform_scoped_id_unique
  on public.conversations(company_id, platform_scoped_id) where platform_scoped_id <> '';
create unique index if not exists messages_platform_message_id_unique
  on public.messages(company_id, platform_message_id) where platform_message_id <> '';
create unique index if not exists comments_platform_comment_id_unique
  on public.comments(company_id, platform_comment_id) where platform_comment_id <> '';

alter table public.tasks add column if not exists followup_id uuid references public.conversation_followups(id) on delete set null;
alter table public.tasks add column if not exists assigned_to text not null default '';
create unique index if not exists tasks_followup_unique on public.tasks(followup_id) where followup_id is not null;
