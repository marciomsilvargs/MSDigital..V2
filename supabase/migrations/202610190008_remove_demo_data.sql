-- Production cleanup. Preserve companies, users and every row received from
-- the real Meta integration while removing records created by simulation tools.
create temporary table demo_conversations on commit drop as
select distinct conversation_id as id
from public.messages
where source = 'demo';

delete from public.comments where source = 'demo' or reply_source = 'demo';
delete from public.automation_runs where source = 'demo';
delete from public.tasks where source = 'demo';
delete from public.stories where execution = 'demo';
delete from public.connections where source = 'demo';
delete from public.messages where source = 'demo';
delete from public.conversations as conversation
where conversation.id in (select id from demo_conversations)
  and not exists (
    select 1 from public.messages as message
    where message.conversation_id = conversation.id
  );

alter table public.messages alter column source set default 'real';
alter table public.comments alter column source set default 'real';
alter table public.automation_runs alter column source set default 'real';
alter table public.tasks alter column source set default 'system';
