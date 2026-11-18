-- Dados de demonstração para validar o dashboard/detalhe antes do primeiro download.
-- Seguro apagar depois: delete from public.notes where company_id = '...';

insert into public.companies (id, cnpj, razao_social, nome_exibicao, cert_validade)
values (
  '11111111-1111-1111-1111-111111111111',
  '30720420000103',
  'Villa Santa Maria Agro Ltda',
  'Villa Santa Maria',
  '2027-04-18T00:00:00Z'
)
on conflict (id) do nothing;

insert into public.company_members (company_id, user_id, role)
select c.id, u.id, 'admin'
from public.companies c, auth.users u
where c.id = '11111111-1111-1111-1111-111111111111'
  and u.email in ('admin@myxml.com.br', 'contador@myxml.com.br')
  and not exists (
    select 1 from public.company_members cm
    where cm.company_id = c.id and cm.user_id = u.id
  );

insert into public.notes (company_id, chave, numero, serie, modelo, emitida_em, valor, situacao, client_name)
select
  '11111111-1111-1111-1111-111111111111',
  n.chave, n.numero, '1', '65',
  n.emitida_em::timestamptz, n.valor, n.situacao, n.client_name
from (values
  ('35261130720420000103650010000001231000000010', '123', '2026-11-18T14:32:00', 258.90, 'autorizada',  'Villa Santa Maria Ltda'),
  ('35261130720420000103650010000001221000000020', '122', '2026-11-18T11:07:00', 119.50, 'autorizada',  'Agropecu' || chr(225) || 'ria Central'),
  ('35261130720420000103650010000001211000000030', '121', '2026-11-17T18:45:00', 432.00, 'rejeitada',   'Mercado Bom Pre' || chr(231) || 'o')
) as n(chave, numero, emitida_em, valor, situacao, client_name)
where not exists (
  select 1 from public.notes x where x.chave = n.chave
);
