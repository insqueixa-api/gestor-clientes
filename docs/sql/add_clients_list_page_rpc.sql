-- Paginação/filtro/busca de verdade no banco pra página de Clientes
-- (app/admin/cliente/page.tsx). Antes, a página baixava TODOS os clientes do
-- tenant de uma vez (vw_clients_list_active/archived, sem LIMIT/OFFSET) e
-- fazia filtro, busca, ordenação e paginação inteiramente em memória no
-- React. As duas views rodam 3 subconsultas caras POR LINHA (apps_names,
-- alerts_open, e principalmente apps_data — um jsonb_agg com
-- LEFT JOIN LATERAL que interpreta o fields_config de cada app procurando
-- campo de data) — recomputadas pras 221 linhas sempre, mesmo mostrando só
-- 50 por página. Isso cresce com o total de clientes, não com o tamanho da
-- página — problema que só piora conforme a base de clientes cresce.
--
-- Fix: get_clients_list_page() filtra/ordena o conjunto candidato inteiro
-- primeiro (barato — só colunas diretas + joins simples), aplica
-- LIMIT/OFFSET, e SÓ ENTÃO junta apps_data (a subconsulta mais cara) contra
-- no máximo p_page_size linhas. apps_names e alerts_open continuam sendo
-- calculadas pro conjunto inteiro (são baratas — um array_agg e um count
-- simples, sem parsing de jsonb) porque duas das 10 chaves de ordenação
-- ("apps" e "alerts") precisam delas pra ordenar certo antes de paginar.
--
-- Único caso em que o "conjunto candidato inteiro" ainda paga o custo da
-- extração de data por app (min_app_expiry): quando o próprio filtro pedido
-- é "app vencendo em X dias" — nesse caso é inerente ao filtro (não dá pra
-- saber se uma linha bate sem inspecionar os apps dela), mas só acontece
-- quando esse filtro específico está ativo, não sempre.
--
-- Nenhuma função usa SECURITY DEFINER — tenant resolvido via auth.uid() +
-- tenant_members, mesmo padrão de get_dashboard_iptv_bundle/
-- get_dashboard_finance_bundle (add_dashboard_bundle_rpcs.sql).
--
-- Decisões confirmadas com o usuário antes de implementar:
--  1) Busca por texto não compara mais com valor formatado ("R$ 49,90") nem
--     status ("Vencido") — só nome, usuário, nome secundário, servidor,
--     plano (período), whatsapp principal/secundário.
--  2) Filtro de app vencendo mantém "15_dias"/"30_dias" exatamente como hoje
--     (sem piso — um app vencido há muito tempo continua batendo nos dois).
--     Nova 3ª opção "mais_30_dias": app cuja expiração mais próxima é a mais
--     de 30 dias, excluindo quem não tem nenhum app com data rastreável
--     (mesma regra de exclusão das outras duas).
--  3) loadScheduledForClients (badge de agendados) passa a escopar só pros
--     ids da página atual, não mais o tenant inteiro — decisão tomada no
--     frontend, não afeta esta função.

-- 1) Wrapper IMMUTABLE pro unaccent() (a função da extensão é STABLE, não
--    IMMUTABLE — Postgres recusa STABLE dentro de expressão de índice).
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$ SELECT public.unaccent('public.unaccent', $1) $$;

-- 2) Índices novos
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_tenant_archived_trial_vencimento
  ON public.clients (tenant_id, is_archived, is_trial, vencimento);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clients_search_trgm
  ON public.clients USING gin (
    public.immutable_unaccent(lower(
      coalesce(display_name, '') || ' ' ||
      coalesce(server_username, '') || ' ' ||
      coalesce(secondary_display_name, '') || ' ' ||
      coalesce(whatsapp_username, '') || ' ' ||
      coalesce(secondary_whatsapp_username, '')
    )) gin_trgm_ops
  );

-- 3) RPC principal: filtro + busca + ordenação + paginação num round trip só.
CREATE OR REPLACE FUNCTION public.get_clients_list_page(
  p_archived        boolean DEFAULT false,
  p_status          text    DEFAULT NULL,   -- 'Ativo' | 'Vencido' | null/'Todos'
  p_search          text    DEFAULT NULL,
  p_server_id       uuid    DEFAULT NULL,
  p_plan_period     text    DEFAULT NULL,   -- bucket de extractPeriod(), ex "Mensal"
  p_due_filter      text    DEFAULT NULL,
  p_app_filter      text    DEFAULT NULL,   -- '15_dias' | '30_dias' | 'mais_30_dias' | nome exato do app | null/'Todos'
  p_sort_key        text    DEFAULT 'due',
  p_sort_dir        text    DEFAULT 'asc',
  p_is_default_sort boolean DEFAULT true,
  p_page            int     DEFAULT 1,
  p_page_size       int     DEFAULT 50
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
  -- busca normalizada (sem acento, minúscula) uma vez só
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
      WHEN c.is_trial THEN 'TRIAL'
      WHEN c.vencimento < now() THEN 'OVERDUE'
      ELSE 'ACTIVE'
    END                                   AS computed_status,
    CASE
      WHEN c.is_archived THEN 'Arquivado'
      WHEN c.is_trial THEN 'Teste'
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
    -- apps_names/alerts_open: baratas (array_agg/count simples), calculadas
    -- pro conjunto inteiro pois "apps"/"alerts" são sortKeys válidas.
    -- ORDER BY a.name dentro do array_agg: as views antigas não tinham isso
    -- (array_agg sem ORDER BY não garante ordem), o que já deixava a ordem
    -- dos badges de app um pouco instável entre carregamentos. Pequena
    -- melhoria de robustez ao mexer nessa mesma lógica — não é uma mudança
    -- de comportamento perceptível (a maioria dos clientes tem 1-2 apps).
    (
      SELECT array_agg(a.name ORDER BY a.name) FROM public.client_apps ca
      JOIN public.apps a ON a.id = ca.app_id
      WHERE ca.client_id = c.id
    )                                      AS apps_names,
    (
      SELECT count(*) FROM public.client_alerts
      WHERE client_alerts.client_id = c.id AND client_alerts.status = 'OPEN'
    )                                      AS alerts_open,
    -- min_app_expiry: só computa a extração cara de data-por-app quando o
    -- próprio filtro pedido depende disso (e nunca pra arquivados, que
    -- também nunca tinham apps_data nas views antigas). IMPORTANTE: a
    -- condição é formulada como "computa SE bater" (não "pula SE não
    -- bater") — com p_app_filter NULL (sem filtro de app, o caso mais
    -- comum), `p_app_filter NOT IN (...)` dá NULL em SQL (não TRUE), e um
    -- CASE WHEN com NULL cai no ELSE — ou seja, a formulação negativa
    -- computaria a subconsulta cara pra TODAS as linhas por engano mesmo
    -- sem filtro de app nenhum. A formulação positiva não tem esse problema
    -- porque `p_app_filter IN (...)` com NULL também dá NULL, mas aqui NULL
    -- cai corretamente no ELSE (não computa).
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
    END                                    AS min_app_expiry,
    ((c.vencimento AT TIME ZONE 'America/Sao_Paulo')::date - sp.today) AS diff_days,
    -- regra especial do sort padrão: vencimento nulo conta como "bucket
    -- principal" (equivalente ao sentinelo "9999-12-31" satisfazer >= -2)
    CASE
      WHEN c.vencimento IS NULL THEN 0
      WHEN ((c.vencimento AT TIME ZONE 'America/Sao_Paulo')::date - sp.today) >= -2 THEN 0
      ELSE 1
    END                                    AS ord_bucket
  FROM public.clients c
  CROSS JOIN sp
  CROSS JOIN q
  JOIN tenant t ON c.tenant_id = t.tenant_id
  LEFT JOIN public.servers s ON c.server_id = s.id
  LEFT JOIN public.plan_tables pt ON c.plan_table_id = pt.id
  WHERE
    c.is_archived = p_archived
    AND c.is_trial = false
    AND (p_status IS NULL OR p_status = 'Todos' OR
      CASE
        WHEN c.is_archived THEN 'Arquivado'
        WHEN c.is_trial THEN 'Teste'
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
      -- os 3 buckets de data (15/30/mais_30 dias) são filtrados depois, no
      -- CTE `filtered` (dependem de min_app_expiry) — aqui só deixa passar.
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
-- filtro de app 15/30/mais_30 dias (precisa do min_app_expiry já calculado
-- acima em `base` — fica num segundo estágio só pra manter o WHERE de cima
-- legível; não reprocessa nada caro de novo).
filtered AS MATERIALIZED (
  SELECT *
  FROM base
  WHERE
    p_app_filter IS NULL OR p_app_filter = 'Todos' OR
    p_app_filter NOT IN ('15_dias', '30_dias', 'mais_30_dias') OR
    (p_app_filter = '15_dias'     AND min_app_expiry IS NOT NULL AND (min_app_expiry - (SELECT today FROM sp)) <= 15) OR
    (p_app_filter = '30_dias'     AND min_app_expiry IS NOT NULL AND (min_app_expiry - (SELECT today FROM sp)) <= 30) OR
    (p_app_filter = 'mais_30_dias' AND min_app_expiry IS NOT NULL AND (min_app_expiry - (SELECT today FROM sp)) >  30)
),
ordered AS (
  SELECT
    f.*,
    row_number() OVER (
      ORDER BY
        CASE WHEN p_is_default_sort AND p_sort_key = 'due' AND p_sort_dir = 'asc' THEN ord_bucket END,

        CASE WHEN p_sort_key = 'name' AND p_sort_dir = 'asc'  THEN public.immutable_unaccent(lower(client_name)) END ASC,
        CASE WHEN p_sort_key = 'name' AND p_sort_dir = 'desc' THEN public.immutable_unaccent(lower(client_name)) END DESC,

        -- "due" compara por dueISODate+dueTime no JS, que só tem precisão de
        -- MINUTO (HH:mm) — por isso trunca aqui também, senão dois clientes
        -- no mesmo minuto (diferindo só em segundos) seriam desempatados de
        -- forma diferente do app atual.
        CASE WHEN p_sort_key = 'due' AND p_sort_dir = 'asc'  THEN date_trunc('minute', vencimento) END ASC,
        CASE WHEN p_sort_key = 'due' AND p_sort_dir = 'desc' THEN date_trunc('minute', vencimento) END DESC,

        CASE WHEN p_sort_key = 'status' AND p_sort_dir = 'asc' THEN
          CASE status_label WHEN 'Vencido' THEN 4 WHEN 'Teste' THEN 3 WHEN 'Arquivado' THEN 2 ELSE 1 END
        END ASC,
        CASE WHEN p_sort_key = 'status' AND p_sort_dir = 'desc' THEN
          CASE status_label WHEN 'Vencido' THEN 4 WHEN 'Teste' THEN 3 WHEN 'Arquivado' THEN 2 ELSE 1 END
        END DESC,

        -- server_name/technology: JS faz `r.server_name || "—"` / `r.technology || "—"`
        -- — coalesce pro mesmo fallback (senão NULL vai pro fim, diferente do "—" no meio).
        CASE WHEN p_sort_key = 'server' AND p_sort_dir = 'asc'  THEN public.immutable_unaccent(lower(coalesce(server_name, '—'))) END ASC,
        CASE WHEN p_sort_key = 'server' AND p_sort_dir = 'desc' THEN public.immutable_unaccent(lower(coalesce(server_name, '—'))) END DESC,

        CASE WHEN p_sort_key = 'technology' AND p_sort_dir = 'asc'  THEN public.immutable_unaccent(lower(coalesce(technology, '—'))) END ASC,
        CASE WHEN p_sort_key = 'technology' AND p_sort_dir = 'desc' THEN public.immutable_unaccent(lower(coalesce(technology, '—'))) END DESC,

        CASE WHEN p_sort_key = 'screens' AND p_sort_dir = 'asc'  THEN screens END ASC,
        CASE WHEN p_sort_key = 'screens' AND p_sort_dir = 'desc' THEN screens END DESC,

        CASE WHEN p_sort_key = 'plan' AND p_sort_dir = 'asc'  THEN public.immutable_unaccent(lower(plan_period)) END ASC,
        CASE WHEN p_sort_key = 'plan' AND p_sort_dir = 'desc' THEN public.immutable_unaccent(lower(plan_period)) END DESC,

        -- value: JS faz Math.round(Number(r.price_amount || 0) * 100) — null vira 0.
        CASE WHEN p_sort_key = 'value' AND p_sort_dir = 'asc'  THEN coalesce(price_amount, 0) END ASC,
        CASE WHEN p_sort_key = 'value' AND p_sort_dir = 'desc' THEN coalesce(price_amount, 0) END DESC,

        CASE WHEN p_sort_key = 'alerts' AND p_sort_dir = 'asc'  THEN alerts_open END ASC,
        CASE WHEN p_sort_key = 'alerts' AND p_sort_dir = 'desc' THEN alerts_open END DESC,

        -- apps: JS faz (r.apps || []).join(", ") — array_agg vazio vira NULL no
        -- Postgres (não array vazio), então sem o coalesce o array_to_string
        -- retorna NULL (vai pro fim) em vez de "" (que ordena primeiro).
        CASE WHEN p_sort_key = 'apps' AND p_sort_dir = 'asc'  THEN public.immutable_unaccent(lower(array_to_string(coalesce(apps_names, '{}'), ', '))) END ASC,
        CASE WHEN p_sort_key = 'apps' AND p_sort_dir = 'desc' THEN public.immutable_unaccent(lower(array_to_string(coalesce(apps_names, '{}'), ', '))) END DESC,

        -- Desempate (nível 1) — igual ao "if (cmp === 0) cmp =
        -- compareText(dueISODate+dueTime)" do JS, que só tem precisão de
        -- MINUTO. O JS faz `return sortDir === "asc" ? cmp : -cmp` sobre o
        -- cmp JÁ COM o desempate aplicado — ou seja, quando a ordenação
        -- pedida é "desc" e os minutos realmente diferem, o desempate
        -- também inverte de direção junto (minuto maior primeiro).
        CASE WHEN p_sort_dir = 'asc'  THEN date_trunc('minute', vencimento) END ASC,
        CASE WHEN p_sort_dir = 'desc' THEN date_trunc('minute', vencimento) END DESC,

        -- Desempate final (nível 2) — quando o MINUTO também empata (dois
        -- clientes no mesmo minuto, diferindo só em segundos), o JS não tem
        -- mais nenhum critério: Array.sort é estável, então a ordem que
        -- sobra é a da busca inicial, que já vem "ORDER BY vencimento ASC"
        -- (ver loadData em cliente/page.tsx) — nunca invertida pelo sortDir
        -- da chave escolhida. Replica isso com vencimento ASC incondicional.
        vencimento ASC
    ) AS rn
  FROM filtered f
),
page_rows AS (
  SELECT * FROM ordered
  WHERE rn > (greatest(p_page, 1) - 1) * greatest(p_page_size, 1)
    AND rn <= greatest(p_page, 1) * greatest(p_page_size, 1)
),
-- apps_data (a subconsulta mais cara) só entra aqui — só pras linhas da
-- página, nunca pro conjunto filtrado inteiro.
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

-- 4) Dropdown: períodos de plano em uso (substitui a derivação client-side
--    "uniqueplano" a partir das linhas já carregadas).
CREATE OR REPLACE FUNCTION public.get_client_plan_periods(p_archived boolean DEFAULT false)
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
  WHERE c.is_archived = p_archived AND c.is_trial = false
  ORDER BY 1;
$function$;

-- 5) Dropdown: apps realmente usados por algum cliente do tenant (substitui
--    a derivação client-side "só mostra se algum cliente carregado tem esse
--    app").
CREATE OR REPLACE FUNCTION public.get_client_used_apps(p_archived boolean DEFAULT false)
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
  WHERE c.is_archived = p_archived AND c.is_trial = false
  ORDER BY 2;
$function$;
