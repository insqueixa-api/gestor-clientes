-- ✅ 12/10/2026, pedido do Márcio: a Linha do tempo do cliente mostra também
-- o que aconteceu com os APLICATIVOS dele (adicionou, configurou, removeu,
-- verificou, falhas — client_app_activity_log) e as RENOVAÇÕES DE APP pagas
-- (client_portal_payments payment_type = app_renewal). Vem na mesma ida ao
-- banco da página (get_client_detail_bundle), sem chamada extra.
-- + logos dos apps (app_icons) e dos servidores (server_logos) pra
-- linha do tempo mostrar a logo no lugar do emoji.
-- + lixeira: admin pode apagar registro do histórico de apps (mesmo escopo
-- de tenant da leitura).

drop policy if exists admin_delete_own_tenant on public.client_app_activity_log;
create policy admin_delete_own_tenant on public.client_app_activity_log
  for delete to authenticated
  using (exists (select 1 from public.tenant_members tm
                  where tm.user_id = auth.uid() and tm.tenant_id = client_app_activity_log.tenant_id));

CREATE OR REPLACE FUNCTION public.get_client_detail_bundle(p_client_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH tenant AS (
    SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.user_id = auth.uid() LIMIT 1
  ),
  row_final AS (
    SELECT v.id, v.tenant_id, v.client_name, v.username, v.server_password, v.vencimento,
           v.computed_status, v.client_is_archived, v.screens, v.plan_name, v.plan_table_id,
           v.plan_table_name, v.price_amount, v.price_currency, v.server_id, v.server_name,
           v.technology, v.whatsapp_e164, v.whatsapp_username, v.whatsapp_opt_in,
           v.dont_message_until, v.secondary_display_name, v.secondary_name_prefix,
           v.secondary_phone_e164, v.secondary_whatsapp_username, v.notes, v.m3u_url,
           v.created_at, v.updated_at, v.apps_names, v.alerts_open, v.name_prefix
    FROM public.vw_clients_list_active v, tenant t
    WHERE v.tenant_id = t.tenant_id AND v.id = p_client_id
    UNION ALL
    SELECT v.id, v.tenant_id, v.client_name, v.username, v.server_password, v.vencimento,
           v.computed_status, v.client_is_archived, v.screens, v.plan_name, v.plan_table_id,
           v.plan_table_name, v.price_amount, v.price_currency, v.server_id, v.server_name,
           v.technology, v.whatsapp_e164, v.whatsapp_username, v.whatsapp_opt_in,
           v.dont_message_until, v.secondary_display_name, v.secondary_name_prefix,
           v.secondary_phone_e164, v.secondary_whatsapp_username, v.notes, v.m3u_url,
           v.created_at, v.updated_at, v.apps_names, v.alerts_open, v.name_prefix
    FROM public.vw_clients_list_archived v, tenant t
    WHERE v.tenant_id = t.tenant_id AND v.id = p_client_id
    LIMIT 1
  ),
  client_row AS (
    SELECT c.plan_table_id, c.notes, c.price_currency, c.m3u_url, c.created_at,
           c.secondary_display_name, c.secondary_phone_e164,
           c.secondary_whatsapp_username, c.name_prefix
    FROM public.clients c, tenant t
    WHERE c.tenant_id = t.tenant_id AND c.id = p_client_id
  ),
  plan_table_row AS (
    SELECT pt.name
    FROM public.plan_tables pt
    WHERE pt.id = (SELECT plan_table_id FROM client_row)
  ),
  apps_catalog AS (
    SELECT id, name, icon_url, fields_config
    FROM public.apps
    WHERE is_active = true
  ),
  client_apps_row AS (
    SELECT id, app_id, field_values
    FROM public.client_apps
    WHERE client_id = p_client_id
  ),
  events AS (
    SELECT e.id, e.created_at, e.event_type, e.message, e.meta
    FROM public.client_events e, tenant t
    WHERE e.tenant_id = t.tenant_id AND e.client_id = p_client_id
    ORDER BY e.created_at DESC
    LIMIT 200
  ),
  app_log AS (
    SELECT l.id, l.created_at, l.event, l.app_name, l.detail, l.client_app_id
    FROM public.client_app_activity_log l, tenant t
    WHERE l.tenant_id = t.tenant_id AND l.client_id = p_client_id
    ORDER BY l.created_at DESC
    LIMIT 100
  ),
  app_payments AS (
    SELECT p.id, coalesce(p.paid_at, p.created_at) AS created_at, p.app_name_snapshot AS app_name,
           p.price_amount, p.price_currency, p.payment_method, p.gateway_type, p.status,
           p.fulfillment_status, p.parent_payment_id, p.server_name
    FROM public.client_portal_payments p, tenant t
    WHERE p.tenant_id = t.tenant_id AND p.client_id = p_client_id
      AND p.payment_type = 'app_renewal'
      AND p.status IN ('approved', 'manual_approved', 'paid')
    ORDER BY coalesce(p.paid_at, p.created_at) DESC
    LIMIT 50
  ),
  -- logo (R2, senão a da AtivaApp) + campos dos apps que aparecem no histórico
  app_icons AS (
    SELECT DISTINCT ON (lower(a.name)) a.id, a.name, coalesce(nullif(a.icon_url, ''), a.appativa_meta->>'logo') AS icon_url, a.fields_config
    FROM public.apps a, tenant t
    WHERE a.tenant_id = t.tenant_id
      AND (lower(a.name) IN (SELECT lower(app_name) FROM app_log)
           OR lower(a.name) IN (SELECT lower(app_name) FROM app_payments)
           OR a.id IN (SELECT app_id FROM client_apps_row))
    ORDER BY lower(a.name), a.is_active DESC
  ),
  server_logos AS (
    SELECT s.id, s.name, s.logo_url
    FROM public.servers s, tenant t
    WHERE s.tenant_id = t.tenant_id
  )
  SELECT jsonb_build_object(
    'row', (SELECT to_jsonb(row_final) FROM row_final LIMIT 1),
    'client_row', (SELECT to_jsonb(client_row) FROM client_row),
    'plan_table_name', (SELECT name FROM plan_table_row),
    'apps_catalog', COALESCE((SELECT jsonb_agg(to_jsonb(apps_catalog)) FROM apps_catalog), '[]'::jsonb),
    'client_apps', COALESCE((SELECT jsonb_agg(to_jsonb(client_apps_row)) FROM client_apps_row), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(to_jsonb(events)) FROM events), '[]'::jsonb),
    'app_log', COALESCE((SELECT jsonb_agg(to_jsonb(app_log)) FROM app_log), '[]'::jsonb),
    'app_payments', COALESCE((SELECT jsonb_agg(to_jsonb(app_payments)) FROM app_payments), '[]'::jsonb),
    'app_icons', COALESCE((SELECT jsonb_agg(to_jsonb(app_icons)) FROM app_icons), '[]'::jsonb),
    'server_logos', COALESCE((SELECT jsonb_agg(to_jsonb(server_logos)) FROM server_logos), '[]'::jsonb)
  );
$function$;
