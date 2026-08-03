-- Otimização de performance do /admin (dashboard principal): a página fazia
-- até ~12 idas ao banco em ondas sequenciais desnecessárias:
--   1) 8 consultas em paralelo (KPIs, due-5-days, finance_cards, 2 séries
--      diárias, top servidores, top apps, server_credit_purchases)
--   2) SÓ DEPOIS (esperando a onda 1 terminar, sem depender dela em nada):
--      3 consultas de finanças pessoais (fin_transacoes, fin_categorias,
--      fin_previsao_snapshot)
--   3) SÓ DEPOIS: busca a lista de contas bancárias (fin_contas_bancarias)
--   4) SÓ DEPOIS: 1 chamada RPC get_saldo_conta POR CONTA (N+1) pra somar
--      o saldo
-- Total: ~4 ondas sequenciais + N chamadas extras, quando praticamente tudo
-- podia rodar em paralelo (as ondas 2-4 não dependiam do resultado da 1).
--
-- Fix: duas funções que devolvem um JSON só cada (uma pro bloco IPTV, outra
-- pro financeiro pessoal), chamadas em paralelo (Promise.all) direto da
-- página. A função IPTV só agrega as 7 views que já existiam (nenhuma
-- lógica de agregação nova, zero risco de mudar números) + a consulta de
-- server_credit_purchases. A função financeira reimplementa as mesmas
-- 3 consultas (mesmo filtro, campo a campo) + substitui o loop de
-- get_saldo_conta por UMA soma agregada de todas as contas numa query só.
--
-- Nenhuma das duas usa SECURITY DEFINER — rodam com o mesmo RLS/permissão
-- do usuário logado, igual as views que já existiam.
--
-- Follow-up: o card "Evolução Consolidada" (components/charts/evolucao-chart.tsx)
-- fazia mais 2 consultas próprias (fin_transacoes e fin_previsao_snapshot dos
-- últimos 12 meses) FORA desse bundle, como um Server Component async
-- separado renderizado depois de tudo. Essas 2 consultas agora entram como
-- 'evolucao_transacoes'/'evolucao_snapshot' dentro do get_dashboard_finance_bundle,
-- e o componente virou puramente apresentacional (recebe os dados já prontos
-- via props, não busca mais nada sozinho).
--
-- Também eliminado: page.tsx fazia seu próprio auth.getUser() + lookup em
-- tenant_members só pra descobrir o tenant_id e repassar pro gráfico —
-- redundante, já que app/admin/layout.tsx já resolve isso via
-- getAdminTenantContext() antes da página renderizar. Como o tenant_id só
-- era usado pra esse gráfico, e o gráfico agora recebe os dados prontos,
-- esse lookup inteiro saiu de page.tsx.

CREATE OR REPLACE FUNCTION public.get_dashboard_iptv_bundle()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
  WITH tenant AS (
    SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.user_id = auth.uid() LIMIT 1
  )
  SELECT jsonb_build_object(
    'kpis', (
      SELECT to_jsonb(k) FROM public.vw_dashboard_kpis_current_month k LIMIT 1
    ),
    'finance_cards', (
      SELECT to_jsonb(f) FROM public.vw_dashboard_finance_cards f LIMIT 1
    ),
    'due', COALESCE((
      SELECT jsonb_agg(to_jsonb(d) ORDER BY d.day_offset)
      FROM public.vw_dashboard_due_5_days d
    ), '[]'::jsonb),
    'regs_daily', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.day)
      FROM public.vw_dashboard_new_registrations_daily_current_month r
    ), '[]'::jsonb),
    'payments_daily', COALESCE((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.day)
      FROM public.vw_dashboard_payments_daily_current_month p
    ), '[]'::jsonb),
    'top_servers', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.clients_created DESC)
      FROM (
        SELECT * FROM public.vw_dashboard_top_servers_current_month
        ORDER BY clients_created DESC
        LIMIT 5
      ) s
    ), '[]'::jsonb),
    'top_apps', COALESCE((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.clients_count DESC)
      FROM (
        SELECT * FROM public.vw_dashboard_top_apps_current_month
        ORDER BY clients_count DESC
        LIMIT 5
      ) a
    ), '[]'::jsonb),
    'purchases', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'created_at', pu.created_at,
        'total_amount_brl', pu.total_amount_brl
      ))
      FROM public.server_credit_purchases pu, tenant t
      WHERE pu.tenant_id = t.tenant_id
        AND pu.created_at >= (
          date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') - interval '1 month'
        )
    ), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_finance_bundle()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
  WITH sp AS (
    SELECT
      date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date AS month_start,
      (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month' - interval '1 day')::date AS month_end,
      (date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') + interval '1 month')::date AS next_month_start,
      to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS ano_mes
  ),
  -- Janela de 12 meses (mês atual + 11 anteriores) pro card "Evolução
  -- Consolidada" (components/charts/evolucao-chart.tsx), que antes fazia
  -- suas próprias 2 consultas fora desse bundle.
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
        'categoria_id', tr.categoria_id
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
        'data_pagamento', tr.data_pagamento
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
