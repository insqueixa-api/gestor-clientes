-- ✅ 12/10/2026, pedido do Márcio ("não deixar a página carregando uma
-- chamada atrás da outra"): tudo que a página do aplicativo
-- (/admin/gerenciador/aplicativo/[id]) precisa, numa ida só ao banco. Antes
-- eram até 4 idas em sequência (app → clientes → pagamentos/histórico →
-- nomes). Os cálculos (custo, margem, totais) continuam em
-- lib/apps/app-overview.ts.
--
-- Vínculo dos registros: client_app_id (app instalado de um cliente). O
-- NOME só vale pra registro sem vínculo (app do cliente já removido) — o
-- catálogo tem nome repetido e casar tudo por nome misturaria apps.
-- Chamado só pela rota do admin (service role, depois do requireAdminTenant).

create or replace function public.app_overview_payload(p_tenant_id uuid, p_app_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with app as (
    select * from apps where id = p_app_id and tenant_id = p_tenant_id
  ),
  links as (
    select ca.id from client_apps ca where ca.app_id = p_app_id and ca.tenant_id = p_tenant_id
  ),
  pays as (
    select p.id, p.created_at, p.paid_at, p.status, p.fulfillment_status, p.price_amount, p.price_currency,
           p.coupon_code, p.coupon_discount_amount, p.payment_method, p.gateway_type, p.client_id,
           p.client_app_id, p.parent_payment_id, p.server_name, c.display_name as client_name
      from client_portal_payments p
      left join clients c on c.id = p.client_id
     where p.tenant_id = p_tenant_id
       and p.payment_type = 'app_renewal'
       and (p.client_app_id in (select id from links)
            or (p.client_app_id is null and lower(p.app_name_snapshot) = lower((select name from app))))
     order by p.created_at desc
     limit 500
  ),
  alerts as (
    select a.id, a.created_at, a.closed_at, a.status, a.amount, a.currency, a.client_id, a.activation_date,
           a.meta, c.display_name as client_name
      from client_alerts a
      left join clients c on c.id = a.client_id
     where a.tenant_id = p_tenant_id
       and a.kind = 'app_activation'
       and (a.client_app_id in (select id from links)
            or (a.client_app_id is null and lower(a.meta->>'app_name') = lower((select name from app))))
     order by a.created_at desc
  ),
  activity as (
    -- ✅ 12/10/2026: login + servidor (pedido do Márcio: "não adianta só o
    -- nome"); MAC/Key/vencimento vêm do app instalado (rows) na lib.
    -- Máximo 100 (a página mostra 50 por página, 2 páginas).
    select l.id, l.created_at, l.event, l.detail, l.client_id, l.client_app_id, c.display_name as client_name,
           c.server_username, s.name as server_name
      from client_app_activity_log l
      left join clients c on c.id = l.client_id
      left join servers s on s.id = c.server_id
     where l.tenant_id = p_tenant_id
       and (l.client_app_id in (select id from links)
            or (l.client_app_id is null and lower(l.app_name) = lower((select name from app))))
     order by l.created_at desc
     limit 100
  )
  select case when not exists (select 1 from app) then null else jsonb_build_object(
    'app', (select to_jsonb(app) from app),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ca.id, 'client_id', ca.client_id, 'created_at', ca.created_at,
               'field_values', ca.field_values, 'license_paid_until', ca.license_paid_until,
               'device_type', ca.device_type, 'm3u_list', ca.m3u_list,
               'clients', jsonb_build_object(
                 'display_name', c.display_name, 'server_username', c.server_username,
                 'is_trial', c.is_trial, 'is_archived', c.is_archived, 'deep_archived_at', c.deep_archived_at,
                 'servers', jsonb_build_object('name', s.name))))
        from client_apps ca
        join clients c on c.id = ca.client_id
        left join servers s on s.id = c.server_id
       where ca.app_id = p_app_id and ca.tenant_id = p_tenant_id), '[]'::jsonb),
    'integration', (select jsonb_build_object('label', i.label, 'is_active', i.is_active)
                      from app_integrations i, app
                     where i.tenant_id = p_tenant_id and i.app_name = app.integration_type limit 1),
    'partners', coalesce((select jsonb_agg(jsonb_build_object('provider', provider, 'credit_unit_price', credit_unit_price))
                            from api_integrations where tenant_id = p_tenant_id), '[]'::jsonb),
    'partner_server', (select s.name from servers s, app where s.id = app.partner_server_id),
    -- cotação atual (cliente EUR/USD paga app na moeda dele e o pagamento é
    -- gravado nela — a página converte pra R$ pra margem/lucro)
    'fx', (select jsonb_build_object('usd_to_brl', usd_to_brl, 'eur_to_brl', eur_to_brl, 'as_of_date', as_of_date)
             from tenant_fx_rates where tenant_id = p_tenant_id order by as_of_date desc limit 1),
    'payments', coalesce((select jsonb_agg(to_jsonb(pays)) from pays), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(to_jsonb(alerts)) from alerts), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(to_jsonb(activity)) from activity), '[]'::jsonb)
  ) end
$$;

revoke all on function public.app_overview_payload(uuid, uuid) from public, anon, authenticated;
grant execute on function public.app_overview_payload(uuid, uuid) to service_role;
