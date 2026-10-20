-- Persistent follow-ups attached to a specific conversation.
-- Safe to run again: the table, index, policy and constraint are guarded.

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'conversations_id_company_unique'
      and conrelid = 'public.conversations'::regclass
  ) then
    alter table public.conversations
      add constraint conversations_id_company_unique unique (id, company_id);
  end if;
end $$;

create table if not exists public.conversation_followups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  conversation_id uuid not null,
  title text not null default 'Retomar conversa',
  note text not null default '',
  due_at timestamptz not null,
  assigned_to text not null default '',
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  reminder_sent_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversation_followups_same_company_fk
    foreign key (conversation_id, company_id)
    references public.conversations(id, company_id) on delete cascade,
  constraint conversation_followups_title_not_blank check (length(trim(title)) > 0)
);

create index if not exists conversation_followups_due_idx
  on public.conversation_followups(company_id, due_at)
  where status = 'pending';
create index if not exists conversation_followups_conversation_idx
  on public.conversation_followups(company_id, conversation_id, due_at desc);

alter table public.conversation_followups enable row level security;
grant select, insert, update, delete on public.conversation_followups to authenticated;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conversation_followups'
      and policyname = 'company_members_manage_conversation_followups'
  ) then
    create policy "company_members_manage_conversation_followups"
      on public.conversation_followups for all to authenticated
      using (public.is_company_member(company_id))
      with check (public.is_company_member(company_id));
  end if;
end $$;
