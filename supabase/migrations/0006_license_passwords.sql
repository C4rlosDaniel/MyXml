-- Cofre da senha informada na criação de usuários pelo painel de licenças.
-- O Supabase Auth não permite ler senhas; guardamos uma cópia criptografada
-- (Fernet, mesma chave do cofre de certificados) para consulta pelo administrador.

create table if not exists public.license_passwords (
  license_id    uuid primary key references public.licenses(id) on delete cascade,
  password_enc  text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.license_passwords enable row level security;

-- Nenhuma policy: somente a service role (API) acessa esta tabela.
revoke all on public.license_passwords from anon, authenticated;
grant select, insert, update, delete on public.license_passwords to service_role;
