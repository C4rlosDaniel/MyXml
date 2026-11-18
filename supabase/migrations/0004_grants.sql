-- Garante os privilégios padrão do Supabase nas tabelas criadas por migrations.
-- RLS continua aplicando: anon/authenticated só veem o que as policies permitem.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;

grant execute on all functions in schema public
  to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;
