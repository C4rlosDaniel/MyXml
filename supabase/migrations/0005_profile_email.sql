-- O front precisa do e-mail em profiles para exibir a lista de licenças.
-- Antes o campo só existia em auth.users, o que quebrava o join PostgREST.

alter table public.profiles add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

create unique index if not exists idx_profiles_email on public.profiles (email);

-- Recria o trigger incluindo o e-mail no perfil.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_role text := coalesce(new.raw_user_meta_data->>'role', 'contador');
begin
  insert into public.profiles (id, full_name, role, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    user_role,
    new.email
  )
  on conflict (id) do nothing;

  insert into public.licenses (user_id, status)
  values (new.id, case when user_role = 'admin' then 'ativo' else 'pendente' end)
  on conflict (user_id) do nothing;

  return new;
end;
$$;
