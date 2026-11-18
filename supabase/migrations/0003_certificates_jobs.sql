-- ============================================================
-- MyXml — cofre de certificados e progresso dos jobs
-- ============================================================

-- Cofre: apenas a API (service role) acessa; sem política para clientes.
create table if not exists public.company_certificates (
  company_id   uuid primary key references public.companies(id) on delete cascade,
  pfx_enc      text not null,
  senha_enc    text not null,
  cnpj         text not null,
  razao_social text not null,
  valido_ate   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.company_certificates enable row level security;
-- Sem policies: anon/authenticated não leem nada. Somente service role (API).

alter table public.download_runs add column if not exists progresso integer not null default 0;
alter table public.download_runs add column if not exists log text;
