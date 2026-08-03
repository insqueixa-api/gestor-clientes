-- Paginação/filtro/busca de verdade no banco pra página de Testes
-- (app/admin/teste/page.tsx) — mesmo ajuste já feito em Clientes
-- (add_clients_list_page_rpc.sql), trazido pra paridade completa a pedido do
-- usuário: antes a página de Testes baixava TODOS os testes do tenant de uma
-- vez (vw_trials_list_active/archived, sem LIMIT/OFFSET) e fazia busca,
-- filtro (só Status/Servidor/App) e ordenação (só 4 chaves) inteiramente em
-- memória no React, com "Mostrar N" cortando a lista renderizada — não é
-- paginação de verdade nenhuma das duas.
--
-- get_trials_list_page() é uma função NOVA e dedicada (não uma extensão
-- parametrizada de get_clients_list_page, que já está testada/aprovada em
-- produção e não deve ser tocada) — clona a mesma estrutura de CTEs
-- (base MATERIALIZED -> filtered MATERIALIZED -> ordered com row_number() ->
-- page_rows -> page_with_apps -> jsonb final), com as diferenças abaixo.
--
-- Nenhuma função usa SECURITY DEFINER — tenant resolvido via auth.uid() +
-- tenant_members, mesmo padrão de get_clients_list_page.
--
-- Diferenças confirmadas/decididas com o usuário antes de implementar:
--  1) WHERE c.is_trial = true (em vez de false). status_label/computed_status
--     têm só 3 estados (Ativo/Vencido/Arquivado) — sem ramo de Teste, porque
--     a linha já É um teste pelo WHERE.
--  2) Vencimento nulo ordena DIFERENTE de Clientes: em Clientes vai pro FINAL
--     da lista ascendente (comportamento decidido naquela migração); em
--     Testes, decisão explícita do usuário foi PRESERVAR o comportamento
--     atual (nulo ordena PRIMEIRO em ASC) — mecanismo real confirmado no
--     código antigo: getTimestamp() monta uma data inválida quando não tem
--     vencimento, cai no fallback epoch 0, que é sempre o menor timestamp
--     possível. Replicamos o efeito OBSERVÁVEL (NULLS FIRST em ASC / NULLS
--     LAST em DESC), não o mecanismo (não vamos por string inválida).
--     Isso vale pra chave 'due', pro desempate de nível 1 (minuto truncado)
--     E pro desempate final incondicional, que também muda de direção:
--     `vencimento DESC NULLS LAST` (não ASC como em Clientes) — porque a
--     busca original de Testes já vinha `ORDER BY vencimento DESC NULLS
--     LAST` (ver loadData em teste/page.tsx) e o Array.sort estável do JS
--     preserva essa ordem em empates reais.
--  3) Busca por texto adota o MESMO conjunto de campos de Clientes (nome,
--     usuário, nome secundário, servidor, plano, whatsapp
--     principal/secundário) — Testes hoje também busca por status
--     ("vencido"), decisão do usuário foi tirar isso e igualar a Clientes.
--  4) Sem p_is_default_sort/ord_bucket — Testes nunca teve a regra especial
--     de "agrupar por proximidade de vencimento" que Clientes tem no sort
--     padrão, e o pedido foi paridade de filtros/chaves de ordenação, não
--     dessa nuance específica. Ordenação padrão simples: sort_key='due',
--     sort_dir='asc'.
--  5) Sem coluna "converted_client_id" no retorno — ela não existe (nem na
--     tabela clients, nem nas views antigas vw_trials_list_*), confirmado
--     direto no banco. A badge "Convertido" já sempre mostra "NÃO" hoje —
--     bug pré-existente, fora do escopo desta migração, não fabricar essa
--     coluna aqui.
--  6) Reaproveita SEM alteração: immutable_unaccent (já existe, não
--     recriar), extração de plan_period, os mesmos 6 buckets de due_filter,
--     filtro de app (nome exato + 15_dias/30_dias/mais_30_dias, com a mesma
--     formulação POSITIVA no guard de min_app_expiry — nunca NOT IN, que já
--     foi um bug real corrigido uma vez em Clientes por causa da lógica de
--     3 valores do SQL: `NULL NOT IN (...)` dá NULL, não TRUE, e o CASE cai
--     no ELSE por engano computando a subconsulta cara sem filtro nenhum).
--  7) Reaproveita os MESMOS índices de Clientes
--     (idx_clients_tenant_archived_trial_vencimento já inclui is_trial nas
--     colunas; idx_clients_search_trgm é sobre texto, não distingue
--     trial/cliente) — nenhum índice novo criado aqui.

CREATE OR REPLACE FUNCTION public.get_trials_list_page(
  p_archived    boolean DEFAULT false,
  p_status      text    DEFAULT NULL,   -- 'Ativo' | 'Vencido' | 'Arquivado' | null/'Todos'
  p_search      text    DEFAULT NULL,
  p_server_id   uuid    DEFAULT NULL,
  p_plan_period text    DEFAULT NULL,
  p_due_filter  text    DEFAULT NULL,
  p_app_filter  text    DEFAULT NULL,   -- '15_dias' | '30_dias' | 'mais_30_dias' | nome exato do app | null/'Todos'
  p_sort_key    text    DEFAULT 'due',
  p_sort_dir    text    DEFAULT 'asc',
  p_page        int     DEFAULT 1,
  p_page_size   int     DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
WITH tenant AS (
  SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.user_id = auth.uid() LIMIT 1
),
sp AS (
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS today
),
q AS (
  SELECT public.immutable_unaccent(lower(btrim(coalesce(p_search, '')))) AS norm
),
base AS MATERIALIZED (
  SELECT
    c.id,
    c.display_name                       AS client_name,
    c.server_username                    AS username,
    c.server_password,
    c.vencimento,
    CASE
      WHEN c.is_archived THEN 'ARCHIVED'
      WHEN c.vencimento < now() THEN 'OVERDUE'
      ELSE 'ACTIVE'
    END                                   AS computed_status,
    CASE
      WHEN c.is_archived THEN 'Arquivado'
      WHEN c.vencimento < now() THEN 'Vencido'
      ELSE 'Ativo'
    END                                   AS status_label,
    c.is_archived                         AS client_is_archived,
    c.screens,
    c.plan_label                         AS plan_name,
    CASE
      WHEN c.plan_label IS NULL OR btrim(c.plan_label) = '' OR btrim(c.plan_label) = '—' THEN '—'
      WHEN lower(c.plan_label) LIKE '%personalizado%' THEN 'Mensal'
      WHEN c.plan_label LIKE '%-%' THEN btrim(split_part(c.plan_label, '-', -1))
      ELSE btrim(c.plan_label)
    END                                   AS plan_period,
    c.plan_table_id,
    pt.name                               AS plan_table_name,
    c.price_amount,
    c.price_currency,
    c.server_id,
    s.name                                AS server_name,
    c.technology,
    c.phone_e164                          AS whatsapp_e164,
    c.whatsapp_username,
    c.whatsapp_opt_in,
    c.whatsapp_snooze_until               AS dont_message_until,
    c.secondary_display_name,
    c.secondary_name_prefix,
    c.secondary_phone_e164,
    c.secondary_whatsapp_username,
    c.notes,
    c.m3u_url,
    c.created_at,
    c.updated_at,
    c.name_prefix,
    (
      SELECT array_agg(a.name ORDER BY a.name) FROM public.client_apps ca
      JOIN public.apps a ON a.id = ca.app_id
      WHERE ca.client_id = c.id
    )                                      AS apps_names,
    (
      SELECT count(*) FROM public.client_alerts
      WHERE client_alerts.client_id = c.id AND client_alerts.status = 'OPEN'
    )                                      AS alerts_open,
    CASE
      WHEN NOT p_archived AND p_app_filter IN ('15_dias', '30_dias', 'mais_30_dias') THEN (
        SELECT min(dv.expire_date)::date
        FROM public.client_apps ca2
        JOIN public.apps a2 ON a2.id = ca2.app_id
        LEFT JOIN LATERAL (
          SELECT ca2.field_values ->> (fc_v.value ->> 'id') AS expire_date
          FROM jsonb_array_elements(a2.fields_config) fc_v(value)
          WHERE (fc_v.value ->> 'type') = 'date'
            AND (ca2.field_values ->> (fc_v.value ->> 'id')) ~ '^\d{4}-\d{2}-\d{2}$'
          LIMIT 1
        ) dv ON true
        WHERE ca2.client_id = c.id
      )
    END                                    AS min_app_expiry
  FROM public.clients c
  CROSS JOIN sp
  CROSS JOIN q
  JOIN tenant t ON c.tenant_id = t.tenant_id
  LEFT JOIN public.servers s ON c.server_id = s.id
  LEFT JOIN public.plan_tables pt ON c.plan_table_id = pt.id
  WHERE
    c.is_archived = p_archived
    AND c.is_trial = true
    AND (p_status IS NULL OR p_status = 'Todos' OR
      CASE
        WHEN c.is_archived THEN 'Arquivado'
        WHEN c.vencimento < now() THEN 'Vencido'
        ELSE 'Ativo'
      END = p_status)
    AND (p_server_id IS NULL OR c.server_id = p_server_id)
    AND (p_plan_period IS NULL OR p_plan_period = 'Todos' OR
      CASE
        WHEN c.plan_label IS NULL OR btrim(c.plan_label) = '' OR btrim(c.plan_label) = '—' THEN '—'
        WHEN lower(c.plan_label) LIKE '%personalizado%' THEN 'Mensal'
        WHEN c.plan_label LIKE '%-%' THEN btrim(split_part(c.plan_label, '-', -1))
        ELSE btrim(c.plan_label)
      END = p_plan_period)
    AND (
      p_due_filter IS NULL OR p_due_filter = 'Todos' OR
      (p_due_filter = 'Venceu há 2 dias' AND ((c.vencimento AT TIME ZONE 'America/Sao_Paulo')::date - sp.today) = -2) OR
      (p_due_filter = 'Venceu Ontem'     AND ((c.vencimento AT TIME ZONE 'America/Sao_Paulo')::date - sp.today) = -1) OR
      (p_due_filter = 'Hoje'             AND ((c.vencimento AT TIME ZONE 'America/Sao_Paulo')::date - sp.today) =  0) OR
      (p_due_filter = 'Vence Amanhã'     AND ((c.vencimento AT TIME ZONE 'America/Sao_Paulo')::date - sp.today) =  1) OR
      (p_due_filter = 'Vence em 2 dias'  AND ((c.vencimento AT TIME ZONE 'America/Sao_Paulo')::date - sp.today) =  2) OR
      (p_due_filter = 'Mês Atual' AND date_trunc('month', c.vencimento AT TIME ZONE 'America/Sao_Paulo')
                                    = date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo'))
    )
    AND (
      p_app_filter IS NULL OR p_app_filter = 'Todos' OR
      p_app_filter IN ('15_dias', '30_dias', 'mais_30_dias') OR
      EXISTS (
        SELECT 1 FROM public.client_apps ca3
        JOIN public.apps a3 ON a3.id = ca3.app_id
        WHERE ca3.client_id = c.id AND a3.name = p_app_filter
      )
    )
    AND (q.norm = '' OR public.immutable_unaccent(lower(
        coalesce(c.display_name, '') || ' ' ||
        coalesce(c.server_username, '') || ' ' ||
        coalesce(c.secondary_display_name, '') || ' ' ||
        coalesce(s.name, '') || ' ' ||
        CASE
          WHEN c.plan_label IS NULL OR btrim(c.plan_label) = '' OR btrim(c.plan_label) = '—' THEN '—'
          WHEN lower(c.plan_label) LIKE '%personalizado%' THEN 'Mensal'
          WHEN c.plan_label LIKE '%-%' THEN btrim(split_part(c.plan_label, '-', -1))
          ELSE btrim(c.plan_label)
        END || ' ' ||
        coalesce(c.whatsapp_username, '') || ' ' ||
        coalesce(c.secondary_whatsapp_username, '')
      )) LIKE '%' || q.norm || '%')
),
filtered AS MATERIALIZED (
  SELECT *
  FROM base
  WHERE
    p_app_filter IS NULL OR p_app_filter = 'Todos' OR
    p_app_filter NOT IN ('15_dias', '30_dias', 'mais_30_dias') OR
    (p_app_filter = '15_dias'      AND min_app_expiry IS NOT NULL AND (min_app_expiry - (SELECT today FROM sp)) <= 15) OR
    (p_app_filter = '30_dias'      AND min_app_expiry IS NOT NULL AND (min_app_expiry - (SELECT today FROM sp)) <= 30) OR
    (p_app_filter = 'mais_30_dias' AND min_app_expiry IS NOT NULL AND (min_app_expiry - (SELECT today FROM sp)) >  30)
),
ordered AS (
  SELECT
    f.*,
    row_number() OVER (
      ORDER BY
        CASE WHEN p_sort_key = 'name' AND p_sort_dir = 'asc'  THEN public.immutable_unaccent(lower(client_name)) END ASC,
        CASE WHEN p_sort_key = 'name' AND p_sort_dir = 'desc' THEN public.immutable_unaccent(lower(client_name)) END DESC,

        -- 'due': vencimento nulo preserva o comportamento atual de Testes
        -- (nulo primeiro em ASC) — NULLS FIRST/LAST invertido em relação a
        -- Clientes, decisão explícita do usuário.
        CASE WHEN p_sort_key = 'due' AND p_sort_dir = 'asc'  THEN date_trunc('minute', vencimento) END ASC NULLS FIRST,
        CASE WHEN p_sort_key = 'due' AND p_sort_dir = 'desc' THEN date_trunc('minute', vencimento) END DESC NULLS LAST,

        CASE WHEN p_sort_key = 'status' AND p_sort_dir = 'asc' THEN
          CASE status_label WHEN 'Vencido' THEN 3 WHEN 'Arquivado' THEN 2 ELSE 1 END
        END ASC,
        CASE WHEN p_sort_key = 'status' AND p_sort_dir = 'desc' THEN
          CASE status_label WHEN 'Vencido' THEN 3 WHEN 'Arquivado' THEN 2 ELSE 1 END
        END DESC,

        CASE WHEN p_sort_key = 'server' AND p_sort_dir = 'asc'  THEN public.immutable_unaccent(lower(coalesce(server_name, '—'))) END ASC,
        CASE WHEN p_sort_key = 'server' AND p_sort_dir = 'desc' THEN public.immutable_unaccent(lower(coalesce(server_name, '—'))) END DESC,

        CASE WHEN p_sort_key = 'technology' AND p_sort_dir = 'asc'  THEN public.immutable_unaccent(lower(coalesce(technology, '—'))) END ASC,
        CASE WHEN p_sort_key = 'technology' AND p_sort_dir = 'desc' THEN public.immutable_unaccent(lower(coalesce(technology, '—'))) END DESC,

        CASE WHEN p_sort_key = 'screens' AND p_sort_dir = 'asc'  THEN screens END ASC,
        CASE WHEN p_sort_key = 'screens' AND p_sort_dir = 'desc' THEN screens END DESC,

        CASE WHEN p_sort_key = 'plan' AND p_sort_dir = 'asc'  THEN public.immutable_unaccent(lower(plan_period)) END ASC,
        CASE WHEN p_sort_key = 'plan' AND p_sort_dir = 'desc' THEN public.immutable_unaccent(lower(plan_period)) END DESC,

        CASE WHEN p_sort_key = 'value' AND p_sort_dir = 'asc'  THEN coalesce(price_amount, 0) END ASC,
        CASE WHEN p_sort_key = 'value' AND p_sort_dir = 'desc' THEN coalesce(price_amount, 0) END DESC,

        CASE WHEN p_sort_key = 'alerts' AND p_sort_dir = 'asc'  THEN alerts_open END ASC,
        CASE WHEN p_sort_key = 'alerts' AND p_sort_dir = 'desc' THEN alerts_open END DESC,

        CASE WHEN p_sort_key = 'apps' AND p_sort_dir = 'asc'  THEN public.immutable_unaccent(lower(array_to_string(coalesce(apps_names, '{}'), ', '))) END ASC,
        CASE WHEN p_sort_key = 'apps' AND p_sort_dir = 'desc' THEN public.immutable_unaccent(lower(array_to_string(coalesce(apps_names, '{}'), ', '))) END DESC,

        -- Desempate (nível 1) — mesmo comportamento de nulo do item 'due'.
        CASE WHEN p_sort_dir = 'asc'  THEN date_trunc('minute', vencimento) END ASC NULLS FIRST,
        CASE WHEN p_sort_dir = 'desc' THEN date_trunc('minute', vencimento) END DESC NULLS LAST,

        -- Desempate final (nível 2) — a busca original de Testes vinha
        -- `ORDER BY vencimento DESC NULLS LAST` (não ASC como em Clientes) e
        -- o Array.sort estável do JS preserva essa ordem em empates reais.
        vencimento DESC NULLS LAST
    ) AS rn
  FROM filtered f
),
page_rows AS (
  SELECT * FROM ordered
  WHERE rn > (greatest(p_page, 1) - 1) * greatest(p_page_size, 1)
    AND rn <= greatest(p_page, 1) * greatest(p_page_size, 1)
),
page_with_apps AS (
  SELECT
    pr.*,
    CASE
      WHEN p_archived THEN NULL
      ELSE (
        SELECT jsonb_agg(jsonb_build_object(
          'name', a2.name,
          'integration_type', coalesce(a2.integration_type, ''),
          'expire_date', dv.expire_date
        ))
        FROM public.client_apps ca2
        JOIN public.apps a2 ON a2.id = ca2.app_id
        LEFT JOIN LATERAL (
          SELECT ca2.field_values ->> (fc_v.value ->> 'id') AS expire_date
          FROM jsonb_array_elements(a2.fields_config) fc_v(value)
          WHERE (fc_v.value ->> 'type') = 'date'
            AND (ca2.field_values ->> (fc_v.value ->> 'id')) ~ '^\d{4}-\d{2}-\d{2}$'
          LIMIT 1
        ) dv ON true
        WHERE ca2.client_id = pr.id
      )
    END AS apps_data
  FROM page_rows pr
)
SELECT jsonb_build_object(
  'total_count', (SELECT count(*) FROM filtered),
  'rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'client_name', client_name,
      'username', username,
      'server_password', server_password,
      'vencimento', vencimento,
      'computed_status', computed_status,
      'client_is_archived', client_is_archived,
      'screens', screens,
      'plan_name', plan_name,
      'plan_table_id', plan_table_id,
      'plan_table_name', plan_table_name,
      'price_amount', price_amount,
      'price_currency', price_currency,
      'server_id', server_id,
      'server_name', server_name,
      'technology', technology,
      'whatsapp_e164', whatsapp_e164,
      'whatsapp_username', whatsapp_username,
      'whatsapp_opt_in', whatsapp_opt_in,
      'dont_message_until', dont_message_until,
      'secondary_display_name', secondary_display_name,
      'secondary_name_prefix', secondary_name_prefix,
      'secondary_phone_e164', secondary_phone_e164,
      'secondary_whatsapp_username', secondary_whatsapp_username,
      'notes', notes,
      'm3u_url', m3u_url,
      'created_at', created_at,
      'updated_at', updated_at,
      'apps_names', apps_names,
      'alerts_open', alerts_open,
      'apps_data', apps_data,
      'name_prefix', name_prefix
    ) ORDER BY rn)
    FROM page_with_apps
  ), '[]'::jsonb)
);
$function$;

-- Dropdown: períodos de plano em uso entre os testes.
CREATE OR REPLACE FUNCTION public.get_trial_plan_periods(p_archived boolean DEFAULT false)
RETURNS TABLE(plan_period text)
LANGUAGE sql
STABLE
AS $function$
  WITH tenant AS (
    SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.user_id = auth.uid() LIMIT 1
  )
  SELECT DISTINCT
    CASE
      WHEN c.plan_label IS NULL OR btrim(c.plan_label) = '' OR btrim(c.plan_label) = '—' THEN '—'
      WHEN lower(c.plan_label) LIKE '%personalizado%' THEN 'Mensal'
      WHEN c.plan_label LIKE '%-%' THEN btrim(split_part(c.plan_label, '-', -1))
      ELSE btrim(c.plan_label)
    END AS plan_period
  FROM public.clients c
  JOIN tenant t ON c.tenant_id = t.tenant_id
  WHERE c.is_archived = p_archived AND c.is_trial = true
  ORDER BY 1;
$function$;

-- Dropdown: apps realmente usados por algum teste do tenant.
CREATE OR REPLACE FUNCTION public.get_trial_used_apps(p_archived boolean DEFAULT false)
RETURNS TABLE(id uuid, name text, integration_type text)
LANGUAGE sql
STABLE
AS $function$
  WITH tenant AS (
    SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.user_id = auth.uid() LIMIT 1
  )
  SELECT DISTINCT a.id, a.name, a.integration_type
  FROM public.client_apps ca
  JOIN public.apps a ON a.id = ca.app_id
  JOIN public.clients c ON c.id = ca.client_id
  JOIN tenant t ON c.tenant_id = t.tenant_id
  WHERE c.is_archived = p_archived AND c.is_trial = true
  ORDER BY 2;
$function$;
