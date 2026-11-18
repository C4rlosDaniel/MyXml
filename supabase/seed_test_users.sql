-- Usuários de teste (senhas fracas — usar apenas em homologação/demonstração).
-- Admin: admin@myxml.com.br / admin123
-- Contador: contador@myxml.com.br / contador123
-- O trigger handle_new_user cria profile + licença automaticamente.

create extension if not exists pgcrypto;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000'::uuid, gen_random_uuid(), 'authenticated', 'authenticated',
  u.email, crypt(u.senha, gen_salt('bf')), now(),
  jsonb_build_object('role', u.role, 'full_name', u.nome),
  now(), now(), '', '', '', ''
from (values
  ('admin@myxml.com.br',      'admin123',    'admin',    'Administrador MyXml'),
  ('contador@myxml.com.br',   'contador123', 'contador', 'Contador de Teste')
) as u(email, senha, role, nome)
where not exists (select 1 from auth.users a where a.email = u.email);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), usr.id, usr.email,
  jsonb_build_object('sub', usr.id::text, 'email', usr.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users usr
where usr.email in ('admin@myxml.com.br', 'contador@myxml.com.br')
  and not exists (
    select 1 from auth.identities i
    where i.user_id = usr.id and i.provider = 'email'
  );

update public.profiles set role = 'admin'
  where id = (select id from auth.users where email = 'admin@myxml.com.br');

update public.licenses set status = 'ativo', valid_until = null
  where user_id in (select id from auth.users where email in ('admin@myxml.com.br', 'contador@myxml.com.br'));
