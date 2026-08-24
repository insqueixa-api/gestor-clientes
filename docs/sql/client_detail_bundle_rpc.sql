-- Otimização da ficha do cliente (app/admin/cliente/[id]/page.tsx, loadData()) —
-- achado na auditoria de 24/08/2026: a função fazia 7 idas ao banco, a
-- maioria delas sem depender uma da outra:
--   1) apps (catálogo, is_active=true)                — independente
--   2) vw_clients_list_active (tenant+id)              — independente
--   3) vw_clients_list_archived (só se a 2 não achou)  — depende de (2)
--   4) clients (plan_table_id, notes, m3u_url, ...)    — independente
--   5) plan_tables (nome oficial da tabela de planos)  — depende de (4)
--   6) client_apps (apps configurados do cliente)      — independente
--   7) client_events (timeline, limit 200)             — independente
-- Só (2)→(3) e (4)→(5) são dependências reais; as outras rodavam em
-- sequência sem precisar. Vira uma função só, resolvendo (2)/(3) com
-- UNION ALL (o cliente só pode estar numa das duas views, nunca nas duas —
-- não precisa de fallback condicional, um client_is_archived só bate numa
-- delas) e o resto em paralelo dentro da própria query.
--
-- Mantém EXATAMENTE o mesmo escopo de segurança de antes: client_apps e
-- plan_tables já eram consultados sem filtro explícito de tenant_id no
-- código original (dependiam só da RLS da tabela) — replicado aqui do
-- mesmo jeito, não estou afrouxando nem apertando nada. client_events e as
-- duas views mantêm o filtro explícito de tenant_id que já tinham.
--
-- Mesmo padrão de segurança do resto do projeto: SEM SECURITY DEFINER —
-- roda com a RLS do usuário logado (as views vw_clients_list_active/
-- archived já são security_invoker=true, confirmado); o CTE "tenant" só
-- evita repetir o join, não é ele quem garante o isolamento.
--
-- O JS de "qual campo é a data de vencimento de cada app" (heurística em
-- cima de field_values/fields_config) continua no cliente — não fiz essa
-- lógica em SQL, só entrego apps_catalog (só os 4 campos usados: id, name,
-- icon_url, fields_config) e client_apps crus, exatamente como antes.

CREATE OR REPLACE FUNCTION public.get_client_detail_bundle(p_client_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
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
  )
  SELECT jsonb_build_object(
    'row', (SELECT to_jsonb(row_final) FROM row_final LIMIT 1),
    'client_row', (SELECT to_jsonb(client_row) FROM client_row),
    'plan_table_name', (SELECT name FROM plan_table_row),
    'apps_catalog', COALESCE((SELECT jsonb_agg(to_jsonb(apps_catalog)) FROM apps_catalog), '[]'::jsonb),
    'client_apps', COALESCE((SELECT jsonb_agg(to_jsonb(client_apps_row)) FROM client_apps_row), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(to_jsonb(events)) FROM events), '[]'::jsonb)
  );
$function$;
