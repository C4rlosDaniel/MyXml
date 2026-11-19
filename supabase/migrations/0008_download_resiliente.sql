-- Download de NFC-e resiliente: permite marcar uma execucao como interrompida
-- (para retomada) e acompanhar quando o job deu o ultimo sinal de vida.

alter table public.download_runs
  drop constraint if exists download_runs_status_check;

alter table public.download_runs
  add constraint download_runs_status_check
  check (status in ('executando', 'concluido', 'com_erros', 'falhou', 'interrompido'));

alter table public.download_runs
  add column if not exists atualizado_em timestamptz not null default now();

create index if not exists idx_runs_company_status
  on public.download_runs (company_id, status, atualizado_em desc);
