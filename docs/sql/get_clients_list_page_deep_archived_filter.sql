-- ✅ 05/09/2026, pedido do Márcio: novo sub-filtro "Arquivado" (deep_archived)
-- dentro da Lixeira (p_archived=true). Adição cirúrgica na função gigante
-- get_clients_list_page — 1 parâmetro novo (default NULL, 100% compatível
-- com quem já chama sem ele) + 1 condição no WHERE. TODO o resto do corpo
-- é idêntico ao que já estava em produção (não reescrevi a lógica de
-- ordenação/paginação, só adicionei em volta dela).
CREATE OR REPLACE FUNCTION public.get_clients_list_page(p_archived boolean DEFAULT false, p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_server_id uuid DEFAULT NULL::uuid, p_plan_period text DEFAULT NULL::text, p_due_filter text DEFAULT NULL::text, p_app_filter text DEFAULT NULL::text, p_sort_key text DEFAULT 'due'::text, p_sort_dir text DEFAULT 'asc'::text, p_is_default_sort boolean DEFAULT true, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_deep_archived boolean DEFAULT NULL::boolean)
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
    c.deep_archived_at                    AS deep_archived_at,
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
    END                                    AS min_app_expiry,
    ((c.vencimento AT TIME ZONE 'America/Sao_Paulo')::date - sp.today) AS diff_days,
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
    -- ✅ NOVO: sub-filtro "Arquivado" (deep_archived) dentro da Lixeira.
    -- NULL (default) = sem filtro, mostra tudo (comportamento de sempre).
    AND (p_deep_archived IS NULL OR (c.deep_archived_at IS NOT NULL) = p_deep_archived)
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

        CASE WHEN p_sort_key = 'due' AND p_sort_dir = 'asc'  THEN date_trunc('minute', vencimento) END ASC,
        CASE WHEN p_sort_key = 'due' AND p_sort_dir = 'desc' THEN date_trunc('minute', vencimento) END DESC,

        CASE WHEN p_sort_key = 'status' AND p_sort_dir = 'asc' THEN
          CASE status_label WHEN 'Vencido' THEN 4 WHEN 'Teste' THEN 3 WHEN 'Arquivado' THEN 2 ELSE 1 END
        END ASC,
        CASE WHEN p_sort_key = 'status' AND p_sort_dir = 'desc' THEN
          CASE status_label WHEN 'Vencido' THEN 4 WHEN 'Teste' THEN 3 WHEN 'Arquivado' THEN 2 ELSE 1 END
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

        CASE WHEN p_sort_dir = 'asc'  THEN date_trunc('minute', vencimento) END ASC,
        CASE WHEN p_sort_dir = 'desc' THEN date_trunc('minute', vencimento) END DESC,

        vencimento ASC
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
      'deep_archived_at', deep_archived_at,
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
