-- Run follow-up reminders inside PostgreSQL so they do not depend on an Edge
-- Function deployment. The job is idempotent and uses row locks to avoid
-- duplicate tasks when executions overlap.
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create or replace function private.process_due_followups()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.conversation_followups%rowtype;
  contact_name text;
  processed integer := 0;
begin
  for item in
    select followup.*
    from public.conversation_followups as followup
    where followup.status = 'pending'
      and followup.reminder_sent_at is null
      and followup.due_at <= now()
    order by followup.due_at
    limit 200
    for update skip locked
  loop
    select conversation.contact_name
      into contact_name
      from public.conversations as conversation
     where conversation.id = item.conversation_id
       and conversation.company_id = item.company_id;

    insert into public.tasks (
      company_id,
      followup_id,
      assigned_to,
      title,
      source,
      done
    ) values (
      item.company_id,
      item.id,
      item.assigned_to,
      'Follow-up vencido: ' || item.title || ' — ' || coalesce(contact_name, 'conversa'),
      'system',
      false
    )
    on conflict (followup_id) where followup_id is not null do nothing;

    update public.conversation_followups
       set reminder_sent_at = now(), updated_at = now()
     where id = item.id
       and company_id = item.company_id
       and reminder_sent_at is null;

    processed := processed + 1;
  end loop;

  return processed;
end;
$$;

revoke all on function private.process_due_followups() from public, anon, authenticated;
grant execute on function private.process_due_followups() to service_role;

-- Completing either side keeps the task and its follow-up in the same state.
create or replace function private.sync_followup_from_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.followup_id is not null
     and new.done is true
     and old.done is distinct from new.done then
    update public.conversation_followups
       set status = 'completed', completed_at = coalesce(completed_at, now()), updated_at = now()
     where id = new.followup_id
       and company_id = new.company_id
       and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists on_task_done_complete_followup on public.tasks;
create trigger on_task_done_complete_followup
after update of done on public.tasks
for each row execute procedure private.sync_followup_from_task();

create or replace function private.sync_task_from_followup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('completed', 'cancelled')
     and old.status is distinct from new.status then
    update public.tasks
       set done = true
     where followup_id = new.id
       and company_id = new.company_id
       and done is false;
  end if;
  return new;
end;
$$;

drop trigger if exists on_followup_closed_complete_task on public.conversation_followups;
create trigger on_followup_closed_complete_task
after update of status on public.conversation_followups
for each row execute procedure private.sync_task_from_followup();

do $$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'msdigital-followups-every-minute'
  loop
    perform cron.unschedule(existing_job);
  end loop;

  perform cron.schedule(
    'msdigital-followups-every-minute',
    '* * * * *',
    'select private.process_due_followups();'
  );
end;
$$;
