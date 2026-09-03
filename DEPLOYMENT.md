# 🚀 Guia de Deploy: Frontend na Vercel + Backend no Supabase

Este guia passo a passo explica como colocar a sua aplicação **FinControl** em produção na **Vercel** com banco de dados, autenticação e RPCs no **Supabase**.

---

## 1. Configuração do Backend no Supabase

1. Acesse **[supabase.com](https://supabase.com)** e crie uma conta gratuita (caso ainda não tenha).
2. Clique em **"New Project"** e escolha:
   - **Name**: `fincontrol` (ou o nome de sua preferência)
   - **Database Password**: Defina uma senha forte.
   - **Region**: `South America (São Paulo)` para menor latência.
3. No painel lateral esquerdo do Supabase, clique em **SQL Editor** (`</>`).
4. Execute as migrations no SQL Editor em ordem sequencial:
   - **Migration 001**: Cole o conteúdo de [`supabase/migrations/001_initial_schema.sql`](./supabase/migrations/001_initial_schema.sql) e clique em **"Run"**.
     - ✅ Cria as 16 tabelas, índices, políticas RLS e RPCs atômicas transacionais.
   - **Migration 002**: Cole o conteúdo de [`supabase/migrations/002_v5_hardening.sql`](./supabase/migrations/002_v5_hardening.sql) e clique em **"Run"**.
     - ✅ Aplica triggers de integridade cross-workspace e lock anti-deadlock de ownership.
   - **Migration 003**: Cole o conteúdo de [`supabase/migrations/003_v7_hardening.sql`](./supabase/migrations/003_v7_hardening.sql) e clique em **"Run"**.
     - ✅ Adiciona suporte para compras parceladas com parcelas já pagas (`paid_installments_count`).
   - **Migration 004**: Cole o conteúdo de [`supabase/migrations/004_v9_rpc_and_schema_alignment.sql`](./supabase/migrations/004_v9_rpc_and_schema_alignment.sql) e clique em **"Run"**.
     - ✅ Alinha a RPC de parcelamento com avanço consecutivo de ciclos e adiciona a RPC de compra avulsa no cartão em 1x.
   - **Migration 005**: Cole o conteúdo de [`supabase/migrations/005_v10_hardening.sql`](./supabase/migrations/005_v10_hardening.sql) e clique em **"Run"**.
     - ✅ Fechamento de privilégios de SECURITY DEFINER com REVOKE/GRANT, triggers cross-workspace estruturais e check de intervalo.
5. Acesse **Project Settings** (ícone de engrenagem) > **API**:
   - Copie a **Project URL** (`https://xxxxxxxxxxxx.supabase.co`)
   - Copie a chave **anon public** (`eyJhbGciOi...`)

---

## 2. Deploy do Frontend na Vercel

### Opção A: Deploy via GitHub (Recomendado)

1. Suba o código deste projeto para o seu GitHub:
   ```bash
   git init
   git add .
   git commit -m "feat: initial commit fincontrol app"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/fincontrol-app.git
   git push -u origin main
   ```
2. Acesse **[vercel.com](https://vercel.com)** e clique em **"Add New..." > "Project"**.
3. Importe o repositório `fincontrol-app` do GitHub.
4. Na seção **Environment Variables**, adicione as duas variáveis copiadas do Supabase:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://xxxxxxxxxxxx.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `sua_chave_anon_aqui`
5. Clique em **"Deploy"**.

---

### Opção B: Deploy via Vercel CLI (Direto do Terminal)

1. Instale e faça login no Vercel CLI:
   ```bash
   npm i -g vercel
   vercel login
   ```
2. No diretório do projeto, execute:
   ```bash
   vercel
   ```
3. Siga as instruções no terminal e adicione as variáveis de ambiente quando solicitado ou pelo painel da Vercel.

---

## 3. Pronto! 🎉

Sua aplicação estará no ar com HTTPS gratuito em um domínio do tipo:
`https://fincontrol-app.vercel.app`

Com dados sincronizados em tempo real, segurança RLS por usuário/workspace e sem custos de servidor!
