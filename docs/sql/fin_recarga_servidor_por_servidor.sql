-- ✅ JÁ APLICADO no Supabase em 01/10/2026 (via Management API) — não precisa rodar de novo.
--
-- Recarga de servidor no Financeiro: de 1 lançamento somado por mês
-- ("IPTV - Recarga de Servidores") pra 1 por servidor
-- ("IPTV - Recarga Servidor <nome>") + série prevista trimestral que a
-- recarga real dá baixa (lib/finance/sync-iptv-lancamentos.ts).

begin;

-- 1) Histórico: cada mês com recarga vira 1 lançamento PAGO por servidor
--    (valor somado do mês, data = última recarga do servidor no mês).
insert into fin_transacoes (
  tenant_id, tipo, descricao, valor, data_vencimento, status, data_pagamento,
  conta_id, categoria_id, is_recorrente, observacoes
)
select
  p.tenant_id,
  'DESPESA',
  'IPTV - Recarga Servidor ' || s.name,
  round(sum(p.total_amount_brl), 2),
  (max(p.created_at) at time zone 'America/Sao_Paulo')::date,
  'PAGO',
  max(p.created_at),
  '06ec8104-f7c1-4516-bfbd-90ce3f02b90c', -- Mercado Pago - PJ
  'e2eb2e5d-b147-460e-b120-a6be1c0c2de9', -- IPTV
  false,
  'Sincronização Automática'
from server_credit_purchases p
join servers s on s.id = p.server_id
where p.tenant_id = 'a5ab0672-c845-4c40-96b9-eeed197e04ed'
group by p.tenant_id, s.name,
  date_trunc('month', p.created_at at time zone 'America/Sao_Paulo');

-- 2) Some o lançamento antigo somado (substituído pelos de cima)
delete from fin_transacoes
where tenant_id = 'a5ab0672-c845-4c40-96b9-eeed197e04ed'
  and descricao = 'IPTV - Recarga de Servidores'
  and observacoes = 'Sincronização Automática';

-- 3) Previsão: trimestral a partir de 01/12/2026, 20 ocorrências (5 anos),
--    1 série por servidor, valor da última rodada de recarga.
with srv(nome, valor) as (
  values ('NaTV', 3750.00), ('Elite', 1200.00), ('Fast', 800.00)
),
serie as (
  select
    srv.nome, srv.valor, g.i,
    (date '2026-12-01' + make_interval(months => 3 * g.i))::date as venc
  from srv cross join generate_series(0, 19) as g(i)
)
insert into fin_transacoes (
  tenant_id, tipo, descricao, valor, data_vencimento, status,
  conta_id, categoria_id, is_recorrente, frequencia, observacoes
)
select
  'a5ab0672-c845-4c40-96b9-eeed197e04ed', 'DESPESA',
  'IPTV - Recarga Servidor ' || nome, valor, venc, 'PENDENTE',
  '06ec8104-f7c1-4516-bfbd-90ce3f02b90c',
  'e2eb2e5d-b147-460e-b120-a6be1c0c2de9',
  true, 'TRIMESTRAL', 'Previsão de recarga'
from serie;

-- 4) Amarra cada série pelo recorrencia_id (= id da 1ª ocorrência),
--    igual a tela faz ao criar um recorrente.
update fin_transacoes t
set recorrencia_id = f.id
from (
  select distinct on (descricao) descricao, id
  from fin_transacoes
  where tenant_id = 'a5ab0672-c845-4c40-96b9-eeed197e04ed'
    and observacoes = 'Previsão de recarga'
  order by descricao, data_vencimento
) f
where t.tenant_id = 'a5ab0672-c845-4c40-96b9-eeed197e04ed'
  and t.observacoes = 'Previsão de recarga'
  and t.descricao = f.descricao;

commit;
