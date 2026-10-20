# MS Studio Digital V2

Painel para gestão de Instagram por agências, implementado como aplicação
React/Vite com Supabase para autenticação, dados, arquivos, rotinas agendadas e
integrações protegidas com a Meta.

## Estrutura

- `frontend/`: React 19, TypeScript, Vite e Tailwind CSS.
- `supabase/migrations/`: esquema PostgreSQL, RLS, Storage e agendamentos.
- `supabase/functions/`: OAuth, webhook, Stories, mensagens e comentários.

## Executar localmente

Crie `frontend/.env.local` a partir de `frontend/.env.example` e preencha as
duas variáveis públicas do Supabase:

```bash
cd frontend
npm install
npm run dev
```

Para gerar a versão de produção:

```bash
cd frontend
npm run build
```

## Supabase

As migrações `202610190001` a `202610190008` criam as tabelas, políticas RLS,
bucket de mídia, follow-ups, integração Meta e rotinas agendadas. A migração 005
é reservada e não importa dados de exemplo; a migração 008 remove registros
antigos de amostra e define fontes operacionais de produção.

As Edge Functions mantêm tokens e credenciais fora do navegador. Configure no
cofre do Supabase:

- `APP_URL`
- `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET`
- `META_APP_ID` e `META_APP_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `META_WEBHOOK_VERIFY_TOKEN`
- `CRON_SECRET`

Callback Meta:

`https://kutyuudkvehbauhgjkat.supabase.co/functions/v1/meta-oauth-callback`

## Vercel

Importe este repositório e escolha `frontend` como **Root Directory**. O build é
`npm run build` e a saída é `dist`. Cadastre estas variáveis para Production,
Preview e Development:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

O arquivo `frontend/vercel.json` mantém as rotas do SPA funcionando ao atualizar
a página. Nunca exponha no frontend a chave `service_role`, tokens Meta ou
segredos das Edge Functions.
