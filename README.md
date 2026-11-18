# MyXml — versão web

Reestruturação do antigo app desktop **Baixar NFC-e** para uma aplicação web
100% em nuvem. Escopo: **baixar/gestionar NFC-e** — não há emissão de notas,
clientes nem produtos/serviços. Visual Modern SaaS ERP (laranja e branco),
autenticação com licenças e integração com SEFAZ/Supabase.

## Estrutura

```
web/                 SPA React + Vite + TypeScript
  src/design-system/ Card, Button, Input, Modal, Toast, Table, Stepper,
                     StatusBadge, Skeleton
  src/features/      auth, admin, dashboard, notas, download, empresas,
                     histórico, configurações, fiscal, layout
  src/services/      integração Supabase/API + modo demo
  src/styles/        tokens, superfícies, animações
api/                 FastAPI (Python) + core SEFAZ adaptado
supabase/migrations  schema + RLS
```

## Como rodar

### Front-end

```powershell
cd web
npm install
npm run dev
```

Abra `http://localhost:5173`.

**Modo demo:** sem `.env.local`, o app roda com dados em `localStorage`:

| Perfil | E-mail | Senha |
|---|---|---|
| Admin | `admin@myxml.com.br` | `admin123` |
| Contador | `contador@myxml.com.br` | `contador123` |

O contador começa com licença **pendente** — entre como admin em outra aba,
abra **Licenças** e autorize para testar o fluxo completo.

### API

```powershell
cd api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Docs interativas: `http://localhost:8000/docs`. `GET /health` responde mesmo
sem Supabase. Configure `api/.env` (ver `.env.example`) para o modo real.

### Supabase

```powershell
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
```

A migration `0001_initial.sql` cria tabelas, gatilhos e políticas de RLS.
Depois, crie o primeiro usuário admin pelo Auth e rode o SQL indicado no fim
da migration para promovê-lo.

## Telas

- Login e aprovação de licença (admin × contador).
- Dashboard com KPIs e últimas notas.
- Lista de notas com filtros, seleção e ações rápidas.
- Detalhe da nota: timeline, chave copiável, DANFE e modais fiscais.
- Baixar notas: empresa, período, XML em pasta/Excel e acompanhamento do job.
- Empresas com upload de certificado A1 e histórico de execuções.
- Configurações: ambiente, série/numeração e certificado.

A integração com Supabase e SEFAZ está preparada nos serviços e na API.

## Deploy

- Front: **https://myfly-rho.vercel.app** (URL do projeto criado na Vercel)
- API: **https://myxml.fly.dev/health** → `{"status":"ok","mode":"live"}`
- `web/vercel.json` configura Vite + rewrites de SPA. Variáveis `VITE_*` já
  apontam para a API na Fly, com `VITE_FORCE_MOCK=false`.
- Deploy manual: `cd web && vercel --prod` / `cd api && flyctl deploy`.
- Banco Supabase **MyXml** com as 4 migrations aplicadas, grants corrigidos
  (`0004_grants.sql`), usuários de teste e empresa/notas de demonstração.

### Usuários de teste

| Perfil | E-mail | Senha |
|---|---|---|
| Admin | `admin@myxml.com.br` | `admin123` |
| Contador | `contador@myxml.com.br` | `contador123` |

Os arquivos `supabase/seed_test_users.sql` e `seed_demo_data.sql` documentam o que
foi inserido (dados de demonstração — remover antes de uso real).

## Fase 1 — ativação do Supabase (checklist)

1. **Rotacione** as chaves que foram enviadas por chat (GitHub, Vercel, Supabase).
2. Crie o usuário admin em *Authentication → Users* no Supabase.
3. Preencha os arquivos já criados e ignorados pelo Git:
   - `web/.env.local` → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - `api/.env` → `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (senha real),
     `CORS_ORIGINS` com o domínio do front. O `CERT_ENCRYPTION_KEY` já foi gerado localmente.
   - As chaves Supabase já estão preenchidas nos `.env` locais. Para não quebrar o
     modo demo enquanto as migrations não são aplicadas, `VITE_FORCE_MOCK=true` e
     `MOCK_MODE=true` estão ativos. Mude ambos para `false` após o passo 4.
4. Rode o assistente (CLI Supabase já instalada, v3.2.0):
   ```powershell
   .\scripts\setup-supabase.ps1 -ProjectRef "ecauinnvvhkxavlgnwvl" -AdminEmail "admin@empresa.com.br" -ApplyAdmin
   ```
   Ele faz `login → link → db push` e promove o usuário a admin com licença ativa.
5. Mude `MOCK_MODE=false` em `api/.env` e reinicie o front (`npm run dev`) e a API
   (`uvicorn app.main:app --reload --port 8000`).

## Integração backend

1. Crie as tabelas no Supabase:
   ```powershell
   supabase login
   supabase link --project-ref SEU_PROJECT_REF
   supabase db push
   ```
   As migrations `0001_initial.sql`, `0002_notas_cliente.sql` e
   `0003_certificates_jobs.sql` criam tabelas, RLS, gatilhos, cofre de
   certificados e o bucket privado `documentos`.
2. Preencha `web/.env.local` e `api/.env` conforme `.env.example`.
   - Front sem `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` → **modo demo** (mock).
   - API com `MOCK_MODE=true` → endpoints de dados respondem `501`.
3. Reinicie o front e a API. Autenticação, licenças, notas, empresas e
   histórico passam a usar o Supabase (RLS + escopo por empresa).

`VITE_API_URL` habilita o download real: a API envia o job em background,
usa o certificado do cofre e grava XMLs/ZIP no Storage. Nenhuma regra fiscal
foi alterada — o core Python original está em `api/core/`.

> Segurança: as chaves enviadas por chat devem ser **rotacionadas**. Use apenas
> a anon/publishable key no front; a service role key fica exclusivamente na API.

## Segurança

- Nunca commite `.env`, tokens ou senhas. Use apenas `.env.example`.
- O certificado A1 **nunca** vai ao browser: upload para a API e armazenamento
  criptografado no servidor/Supabase Vault.
- As chaves do Supabase no front são apenas a **anon key**; a service role key
  fica exclusivamente na API.
