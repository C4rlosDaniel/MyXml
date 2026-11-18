-- Substitua pelo e-mail do primeiro administrador e rode no SQL Editor.
-- O usuário precisa existir antes em Authentication → Users.

-- update public.profiles set role = 'admin'
--   where id = (select id from auth.users where email = 'admin@empresa.com.br');

-- update public.licenses set status = 'ativo', valid_until = null
--   where user_id = (select id from auth.users where email = 'admin@empresa.com.br');
