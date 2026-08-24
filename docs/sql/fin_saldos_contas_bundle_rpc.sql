-- Otimização do Financeiro Pessoal (app/admin/settings/financeiro_pessoal/
-- page.tsx, carregarDados()) — achado na auditoria de 24/08/2026: pra cada
-- conta bancária, a página chamava get_saldo_conta(conta_id) em loop
-- sequencial (N idas ao banco, uma por conta). Mesmo anti-padrão já
-- identificado e corrigido no dashboard principal (ver comentário no topo
-- de add_dashboard_bundle_rpcs.sql) — lá a solução foi somar TODAS as
-- contas numa query só (porque o dashboard só precisa do total). Aqui a
-- página precisa do saldo POR CONTA (usado nos filtros e no
-- ModalAjusteSaldo), então em vez de somar tudo, devolve um mapa
-- {conta_id: saldo} numa chamada só.
--
-- Mesma fórmula exata do get_saldo_conta original (saldo_inicial + receitas
-- PAGO - despesas PAGO), só que calculada pra todas as contas do tenant de
-- uma vez via jsonb_object_agg, em vez de uma chamada RPC por conta.
--
-- Diferente do get_saldo_conta original (que é SECURITY DEFINER), esta
-- função NÃO precisa disso — mesmo padrão do resto do projeto: roda com a
-- RLS do usuário logado (get_dashboard_finance_bundle já prova que dá pra
-- calcular esse mesmo agregado sem SECURITY DEFINER).

CREATE OR REPLACE FUNCTION public.get_fin_saldos_contas()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
  WITH tenant AS (
    SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.user_id = auth.uid() LIMIT 1
  )
  SELECT COALESCE(jsonb_object_agg(
    cb.id,
    cb.saldo_inicial
      + COALESCE((
          SELECT sum(tr.valor) FROM public.fin_transacoes tr
          WHERE tr.conta_id = cb.id AND tr.tipo = 'RECEITA' AND tr.status = 'PAGO'
        ), 0)
      - COALESCE((
          SELECT sum(tr.valor) FROM public.fin_transacoes tr
          WHERE tr.conta_id = cb.id AND tr.tipo = 'DESPESA' AND tr.status = 'PAGO'
        ), 0)
  ), '{}'::jsonb)
  FROM public.fin_contas_bancarias cb, tenant t
  WHERE cb.tenant_id = t.tenant_id;
$function$;
