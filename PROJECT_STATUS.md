# Estado do projeto

## Arquitetura

- Frontend React 19, TypeScript e Vite em `frontend/`.
- Autenticação, PostgreSQL, Storage, RLS, agendamentos e Edge Functions no
  Supabase `kutyuudkvehbauhgjkat`.
- O diretório `backend/` é legado e não é necessário para executar o produto
  publicado na Vercel.

## Produção

- Migrações `202610190001` a `202610190007` aplicadas no Supabase.
- Migração `202610190008` preparada para remover registros antigos de amostra e
  mudar os valores padrão operacionais para fontes de produção.
- Doze Edge Functions implantadas. `cron-stories` e `instagram-webhook` foram
  atualizadas para impedir publicações ou mensagens sem uma conexão Meta real.
- Os jobs de Stories e follow-ups estão ativos no Supabase Cron.
- Os segredos internos do servidor estão configurados no cofre do Supabase.
- A interface não contém botões ou rotas que criem comentários, mensagens,
  conexões ou publicações simuladas.
- `npm run build` conclui com sucesso.

## Configuração externa pendente

A integração real com Instagram/Facebook exige credenciais emitidas pela conta
Meta: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `META_APP_ID` e
`META_APP_SECRET`. Sem esses valores, o CRM, empresas, equipe, calendário,
automações, follow-ups e relatórios funcionam no Supabase, mas OAuth, webhooks,
publicação de Stories e respostas reais permanecem indisponíveis.

Depois da implantação na Vercel, `APP_URL` e as URLs autorizadas do Supabase
devem usar o domínio definitivo da aplicação.
