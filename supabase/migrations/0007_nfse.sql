-- Módulo NFS-e Nacional (ADN) — somente download/consulta.
-- Estrutura espelha o fluxo de NFC-e: jobs, notas e último NSU por empresa.

create table if not exists public.nfse_notes (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  nsu             bigint not null,
  chave           text not null,
  numero          text,
  serie           text,
  emitida_em      timestamptz,
  valor           numeric(14, 2) not null default 0,
  situacao        text not null default 'autorizada'
                    check (situacao in ('autorizada', 'cancelada')),
  prestador_cnpj  text,
  tomador_cnpj    text,
  storage_path    text,
  eventos         text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, nsu)
);

create table if not exists public.nfse_download_runs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  user_id      uuid references public.profiles(id) on delete set null,
  status       text not null default 'executando'
                 check (status in ('executando', 'concluido', 'com_erros', 'falhou')),
  nsu_ini      bigint not null default 0,
  nsu_fim      bigint not null default 0,
  baixadas     integer not null default 0,
  ja_existiam  integer not null default 0,
  erros        integer not null default 0,
  progresso    integer not null default 0,
  mensagem     text,
  log          text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

create table if not exists public.nfse_sync_state (
  company_id   uuid primary key references public.companies(id) on delete cascade,
  ultimo_nsu   bigint not null default 0,
  updated_at   timestamptz not null default now()
);

create index if not exists idx_nfse_notes_company on public.nfse_notes (company_id);
create index if not exists idx_nfse_notes_chave on public.nfse_notes (chave);
create index if not exists idx_nfse_runs_company on public.nfse_download_runs (company_id);

alter table public.nfse_notes          enable row level security;
alter table public.nfse_download_runs  enable row level security;
alter table public.nfse_sync_state     enable row level security;

-- Leitura para admin/membros da empresa; escrita apenas pela API (service role).
drop policy if exists nfse_notes_select on public.nfse_notes;
create policy nfse_notes_select on public.nfse_notes
  for select to authenticated
  using (
    public.current_role() = 'admin'
    or exists (
      select 1 from public.company_members cm
      where cm.company_id = nfse_notes.company_id and cm.user_id = auth.uid()
    )
  );

drop policy if exists nfse_runs_select on public.nfse_download_runs;
create policy nfse_runs_select on public.nfse_download_runs
  for select to authenticated
  using (
    public.current_role() = 'admin'
    or user_id = auth.uid()
    or exists (
      select 1 from public.company_members cm
      where cm.company_id = nfse_download_runs.company_id and cm.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.nfse_notes,
  public.nfse_download_runs, public.nfse_sync_state to service_role;
