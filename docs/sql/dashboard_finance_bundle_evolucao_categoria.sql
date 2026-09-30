-- =====================================================================
-- 30/09/2026 — Lucro líquido do IPTV no dashboard (pedido do Márcio)
-- =====================================================================
-- O card "Mês Anterior" precisa das despesas da categoria IPTV do mês
-- passado (domínios, GerenciaApp, ProxyBR, Duplecast, Appativa...), mas
-- 'transacoes' só traz o mês atual. 'evolucao_transacoes' já cobre os
-- últimos 12 meses — só faltavam categoria_id e descricao nela. Mudança
-- aditiva: mesmo corpo de antes + esses 2 campos.
create or replace function public.get_dashboard_finance_bundle()
returns jsonb
language sql
stable
as $function$
  WITH sp AS (
    SELECT
      date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date AS month_start,
      (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month' - interval '1 day')::date AS month_end,
      (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month')::date AS next_month_start,
      to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS ano_mes
  ),
  evol AS (
    SELECT
      (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '11 months')::date AS start_date,
      (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month' - interval '1 day')::date AS end_date
  ),
  tenant AS (
    SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.user_id = auth.uid() LIMIT 1
  )
  SELECT jsonb_build_object(
    'categorias', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'icone', c.icone))
      FROM public.fin_categorias c, tenant t
      WHERE c.tenant_id = t.tenant_id
    ), '[]'::jsonb),
    'transacoes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', tr.id,
        'tipo', tr.tipo,
        'valor', tr.valor,
        'status', tr.status,
        'data_vencimento', tr.data_vencimento,
        'data_pagamento', tr.data_pagamento,
        'categoria_id', tr.categoria_id,
        'descricao', tr.descricao
      ))
      FROM public.fin_transacoes tr, tenant t, sp
      WHERE tr.tenant_id = t.tenant_id
        AND (
          (tr.data_vencimento >= sp.month_start AND tr.data_vencimento <= sp.month_end)
          OR (tr.status = 'PAGO' AND tr.data_pagamento >= sp.month_start AND tr.data_pagamento < sp.next_month_start)
        )
    ), '[]'::jsonb),
    'snapshot', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'transacao_id', s.transacao_id,
        'client_id', s.client_id,
        'origem', s.origem,
        'tipo', s.tipo,
        'valor', s.valor,
        'categoria_id', s.categoria_id
      ))
      FROM public.fin_previsao_snapshot s, tenant t, sp
      WHERE s.tenant_id = t.tenant_id AND s.ano_mes = sp.ano_mes
    ), '[]'::jsonb),
    'evolucao_transacoes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', tr.id,
        'tipo', tr.tipo,
        'valor', tr.valor,
        'status', tr.status,
        'data_vencimento', tr.data_vencimento,
        'data_pagamento', tr.data_pagamento,
        'categoria_id', tr.categoria_id,
        'descricao', tr.descricao
      ))
      FROM public.fin_transacoes tr, tenant t, evol e
      WHERE tr.tenant_id = t.tenant_id
        AND (
          (tr.data_vencimento >= e.start_date AND tr.data_vencimento <= e.end_date)
          OR (tr.status = 'PAGO' AND tr.data_pagamento >= e.start_date AND tr.data_pagamento < e.end_date + interval '1 day')
        )
    ), '[]'::jsonb),
    'evolucao_snapshot', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'ano_mes', s.ano_mes,
        'transacao_id', s.transacao_id,
        'origem', s.origem,
        'tipo', s.tipo,
        'valor', s.valor
      ))
      FROM public.fin_previsao_snapshot s, tenant t, evol e
      WHERE s.tenant_id = t.tenant_id
        AND s.ano_mes >= to_char(e.start_date, 'YYYY-MM')
        AND s.ano_mes <= to_char(e.end_date, 'YYYY-MM')
    ), '[]'::jsonb),
    'saldo_atual', COALESCE((
      SELECT sum(
        cb.saldo_inicial
        + COALESCE((
            SELECT sum(tr.valor) FROM public.fin_transacoes tr
            WHERE tr.conta_id = cb.id AND tr.tipo = 'RECEITA' AND tr.status = 'PAGO'
          ), 0)
        - COALESCE((
            SELECT sum(tr.valor) FROM public.fin_transacoes tr
            WHERE tr.conta_id = cb.id AND tr.tipo = 'DESPESA' AND tr.status = 'PAGO'
          ), 0)
      )
      FROM public.fin_contas_bancarias cb, tenant t
      WHERE cb.tenant_id = t.tenant_id
    ), 0)
  );
$function$;
