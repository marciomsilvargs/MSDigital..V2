-- Seed the initial Alpha Clube de Tiro knowledge base when the company exists.
do $$
declare
  c uuid;
  b uuid;
  v uuid;
  next_v uuid;
  a uuid;
begin
  select id into c from public.companies where lower(name) = lower('Alpha') limit 1;
  if c is null then return; end if;
  insert into public.knowledge_bases (company_id, name, description)
    values (c, 'Base principal', 'Informações oficiais da Alpha Clube de Tiro')
    on conflict (company_id) do update set updated_at = now()
    returning id into b;
  if b is null then select id into b from public.knowledge_bases where company_id = c; end if;
  select id into v from public.knowledge_versions where knowledge_base_id = b and status = 'draft' order by version_number desc limit 1;
  if v is null then
    insert into public.knowledge_versions (company_id, knowledge_base_id, version_number, status)
      values (c, b, coalesce((select max(version_number) + 1 from public.knowledge_versions where knowledge_base_id = b), 1), 'draft') returning id into v;
  end if;
  insert into public.ai_assistants (company_id, name, personality, mode, enabled, human_handoff_enabled)
    values (c, 'Assistente Alpha', 'Atencioso, claro, objetivo e profissional.', 'supervised', false, true)
    on conflict (company_id) do update set updated_at = now()
    returning id into a;
  if a is null then select id into a from public.ai_assistants where company_id = c; end if;
  if not exists (select 1 from public.knowledge_entries where company_id = c and knowledge_version_id = v) then
    insert into public.knowledge_entries (company_id, knowledge_version_id, kind, title, content) values
      (c, v, 'institutional', 'Alpha Clube de Tiro', 'Clube de tiro com atendimento para associados, cursos e eventos.'),
      (c, v, 'price', 'Associações anuais', 'Individual: R$ 690. Casal: R$ 900. Segurança Pública: R$ 400. Parcelamento em até 12x sem juros.'),
      (c, v, 'hours', 'Horários de funcionamento', 'Segunda a sexta: loja abre às 13h. Linha de tiro das 18h às 21h. Sábado: loja e linha de tiro das 9h às 17h. Domingo: fechado.'),
      (c, v, 'event', 'Eventos recorrentes', 'Café da manhã dos sócios aos sábados. Churrasco às quintas-feiras, a partir das 21h.'),
      (c, v, 'price', 'Jantar para sócios e não sócios', 'Jantar para sócios: R$ 55. Jantar para não sócios: R$ 75.'),
      (c, v, 'event', 'Cortes habituais', 'Costelão, entrecôte e contrafilé.'),
      (c, v, 'service', 'Estrutura', 'Pista de 7 metros, pista de 20 metros, pista 360 e Área Kids.'),
      (c, v, 'course', 'Cursos', 'Consultar disponibilidade, datas, valores, requisitos e materiais informativos na equipe da Alpha.'),
      (c, v, 'faq', 'Transferência para atendimento humano', 'Quando necessário, encaminhar a conversa para a equipe da Alpha Clube de Tiro.'),
      (c, v, 'faq', 'Informação não encontrada', 'Quando a base não tiver a resposta, informar que a equipe poderá confirmar o dado e oferecer atendimento humano.');
  end if;
  update public.knowledge_versions set status = 'published', published_at = now() where id = v;
  update public.ai_assistants set active_knowledge_version_id = v, updated_at = now() where id = a;
  select id into next_v from public.knowledge_versions where knowledge_base_id = b and status = 'draft' order by version_number desc limit 1;
  if next_v is null then
    insert into public.knowledge_versions (company_id, knowledge_base_id, version_number, status) values (c, b, (select version_number + 1 from public.knowledge_versions where id = v), 'draft') returning id into next_v;
    insert into public.knowledge_entries (company_id, knowledge_version_id, kind, title, content, metadata, active)
      select company_id, next_v, kind, title, content, metadata, active from public.knowledge_entries where knowledge_version_id = v;
  end if;
end $$;

