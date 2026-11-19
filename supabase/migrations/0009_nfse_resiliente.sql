-- NFS-e resiliente: permite pausar/retomar a busca (status "interrompido") e
-- acompanhar o último sinal de vida do job, como no download de NFC-e.

alter table public.nfse_download_runs
  drop constraint if exists nfse_download_runs_status_check;

alter table public.nfse_download_runs
  add constraint nfse_download_runs_status_check
  check (status in ('executando', 'concluido', 'com_erros', 'falhou', 'interrompido'));

alter table public.nfse_download_runs
  add column if not exists atualizado_em timestamptz not null default now();

create index if not exists idx_nfse_runs_company_status
  on public.nfse_download_runs (company_id, status, atualizado_em desc);
