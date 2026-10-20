-- Create a company from the authenticated user's JWT in one transaction.
-- The SECURITY DEFINER routine owns the insert path, while still deriving the
-- owner from auth.uid(); clients cannot choose another user as the owner.
create or replace function public.create_company_for_current_user(company_name text, company_segment text default '')
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  created_company public.companies;
begin
  if current_user_id is null then
    raise exception 'Sessão não autenticada.' using errcode = '28000';
  end if;
  if length(trim(coalesce(company_name, ''))) = 0 then
    raise exception 'Informe o nome da empresa.' using errcode = '22023';
  end if;

  insert into public.companies(name, segment, created_by)
  values (trim(company_name), trim(coalesce(company_segment, '')), current_user_id)
  returning * into created_company;

  insert into public.company_members(company_id, user_id, role)
  values (created_company.id, current_user_id, 'owner')
  on conflict (company_id, user_id) do update set role = 'owner';

  return created_company;
end;
$$;

revoke all on function public.create_company_for_current_user(text, text) from public, anon;
grant execute on function public.create_company_for_current_user(text, text) to authenticated;
