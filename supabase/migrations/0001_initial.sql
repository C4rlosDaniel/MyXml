-- ============================================================
-- MyXml — schema inicial (Etapa 1)
-- Banco: Supabase Postgres. Executar com `supabase db push`.
-- Nenhum dado legado é importado: estrutura nova, do zero.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  role       text not null default 'contador' check (role in ('admin', 'contador')),
  created_at timestamptz not null default now()
);

create table if not exists public.licenses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references public.profiles(id) on delete cascade,
  status       text not null default 'pendente'
                 check (status in ('pendente', 'ativo', 'bloqueado', 'expirado')),
  valid_until  timestamptz,
  activated_by uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.companies (
  id            uuid primary key default gen_random_uuid(),
  cnpj          text not null unique,
  razao_social  text not null,
  nome_exibicao text,
  cert_validade timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'contador' check (role in ('admin', 'contador')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  chave      text not null,
  numero     text,
  serie      text,
  modelo     text not null default '65',
  emitida_em timestamptz,
  valor      numeric(14, 2) not null default 0,
  situacao   text not null default 'autorizada'
               check (situacao in ('rascunho', 'enviada', 'autorizada', 'rejeitada', 'cancelada')),
  storage_path text,
  created_at timestamptz not null default now(),
  unique (company_id, chave)
);

create table if not exists public.download_runs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  user_id      uuid references public.profiles(id) on delete set null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'executando'
                 check (status in ('executando', 'concluido', 'com_erros', 'falhou')),
  periodo_ini  date,
  periodo_fim  date,
  baixadas     integer not null default 0,
  ja_existiam  integer not null default 0,
  erros        integer not null default 0,
  mensagem     text
);

create table if not exists public.settings (
  company_id uuid not null references public.companies(id) on delete cascade,
  key        text not null,
  value      text,
  primary key (company_id, key)
);

create index if not exists idx_notes_company on public.notes (company_id);
create index if not exists idx_notes_emitida on public.notes (emitida_em desc);
create index if not exists idx_runs_company on public.download_runs (company_id);
create index if not exists idx_members_user on public.company_members (user_id);

-- ---------------------------------------------------------------------------
-- Funções auxiliares
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER evita recursão entre a policy de profiles e esta consulta.
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

revoke all on function public.current_role() from public;
grant execute on function public.current_role() to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_companies_updated on public.companies;
create trigger trg_companies_updated before update on public.companies
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_licenses_updated on public.licenses;
create trigger trg_licenses_updated before update on public.licenses
  for each row execute function public.touch_updated_at();

-- Cria perfil + licença automaticamente quando um usuário é cadastrado no Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_role text := coalesce(new.raw_user_meta_data->>'role', 'contador');
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    user_role
  )
  on conflict (id) do nothing;

  insert into public.licenses (user_id, status)
  values (new.id, case when user_role = 'admin' then 'ativo' else 'pendente' end)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.licenses        enable row level security;
alter table public.companies       enable row level security;
alter table public.company_members enable row level security;
alter table public.notes           enable row level security;
alter table public.download_runs   enable row level security;
alter table public.settings        enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.current_role() = 'admin');

-- licenses
drop policy if exists licenses_select on public.licenses;
create policy licenses_select on public.licenses
  for select to authenticated
  using (user_id = auth.uid() or public.current_role() = 'admin');

drop policy if exists licenses_admin_update on public.licenses;
create policy licenses_admin_update on public.licenses
  for update to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- companies
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
  for select to authenticated
  using (
    public.current_role() = 'admin'
    or exists (
      select 1 from public.company_members cm
      where cm.company_id = companies.id and cm.user_id = auth.uid()
    )
  );

drop policy if exists companies_admin_write on public.companies;
create policy companies_admin_write on public.companies
  for all to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- company_members
drop policy if exists members_select on public.company_members;
create policy members_select on public.company_members
  for select to authenticated
  using (user_id = auth.uid() or public.current_role() = 'admin');

drop policy if exists members_admin_write on public.company_members;
create policy members_admin_write on public.company_members
  for all to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- notes
drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes
  for select to authenticated
  using (
    public.current_role() = 'admin'
    or exists (
      select 1 from public.company_members cm
      where cm.company_id = notes.company_id and cm.user_id = auth.uid()
    )
  );

-- download_runs
drop policy if exists runs_select on public.download_runs;
create policy runs_select on public.download_runs
  for select to authenticated
  using (
    public.current_role() = 'admin'
    or user_id = auth.uid()
    or exists (
      select 1 from public.company_members cm
      where cm.company_id = download_runs.company_id and cm.user_id = auth.uid()
    )
  );

-- settings
drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated
  using (
    public.current_role() = 'admin'
    or exists (
      select 1 from public.company_members cm
      where cm.company_id = settings.company_id and cm.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Storage (XMLs / DANFE / planilhas)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;

-- TODO: políticas de storage.objects por empresa (usar company_members no path).
-- Enquanto não definidas, o bucket permanece privado (acesso só via service role).

-- ---------------------------------------------------------------------------
-- Como criar o primeiro admin
-- ---------------------------------------------------------------------------
-- 1) Crie o usuário em Authentication → Users (ou via invite).
-- 2) No SQL Editor:
--      update public.profiles set role = 'admin' where email... -- profiles não tem email;
--      use: update public.profiles set role = 'admin'
--           where id = (select id from auth.users where email = 'admin@myxml.com.br');
--    e:  update public.licenses set status = 'ativo'
--        where user_id = (select id from auth.users where email = 'admin@myxml.com.br');
