-- ============================================================
-- MyXml — coluna de cliente na nota (Etapa de integração)
-- Executar depois de 0001_initial.sql: supabase db push
-- NOTA: a migration antiga 0002_cadastros.sql (clientes/produtos)
-- foi removida porque esses cadastros não fazem parte do sistema.
-- ============================================================

alter table public.notes add column if not exists client_name text;
