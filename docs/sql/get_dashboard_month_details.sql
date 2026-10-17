-- ✅ 17/10/2026, pedido do Márcio: tooltip dos gráficos do Dashboard mostra
-- QUEM (cadastros: nome/usuário/servidor; pagamentos: cliente/revenda/app e
-- valor) em vez de só o total do dia. Mesmas regras de data/valor das views
-- vw_dashboard_new_registrations_daily_current_month e
-- vw_dashboard_payments_daily_current_month (mês atual, horário de SP).
-- SECURITY INVOKER (RLS vale) — tenant pelo auth.uid(), igual aos bundles.
create or replace function public.get_dashboard_month_details()
returns jsonb
language sql
stable
set search_path to 'public', 'extensions'
as $$
  with tenant as (
    select tm.tenant_id from public.tenant_members tm where tm.user_id = auth.uid() limit 1
  ), sp as (
    select (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') as month_start_ts
  ), fx as (
    select coalesce(f.usd_to_brl, 5::numeric) usd, coalesce(f.eur_to_brl, 6::numeric) eur
      from tenant t left join public.tenant_fx_rates f on f.tenant_id = t.tenant_id
  )
  select jsonb_build_object(
    'regs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', (c.created_at at time zone 'America/Sao_Paulo')::date,
               'name', c.display_name,
               'username', c.server_username,
               'server', s.name,
               'is_trial', coalesce(c.is_trial, false)
             ) order by c.created_at)
        from public.clients c
        join tenant t on t.tenant_id = c.tenant_id
        cross join sp
        left join public.servers s on s.id = c.server_id
       where c.created_at >= sp.month_start_ts
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(x order by x->>'at') from (
        -- clientes (renovações — mesma fonte do card Clientes)
        select jsonb_build_object(
                 'at', r.created_at,
                 'day', (r.created_at at time zone 'America/Sao_Paulo')::date,
                 'kind', 'cliente',
                 'name', coalesce(c.display_name, 'Cliente'),
                 'detail', s.name,
                 'amount', coalesce(r.total_amount, 0)
               ) x
          from public.client_renewals r
          join tenant t on t.tenant_id = r.tenant_id
          cross join sp
          left join public.clients c on c.id = r.client_id
          left join public.servers s on s.id = coalesce(r.server_id, c.server_id)
         where r.created_at >= sp.month_start_ts
        union all
        -- revenda (créditos vendidos)
        select jsonb_build_object(
                 'at', v.created_at,
                 'day', (v.created_at at time zone 'America/Sao_Paulo')::date,
                 'kind', 'revenda',
                 'name', coalesce(rs.display_name, 'Revenda'),
                 'detail', concat_ws(' · ', s.name, v.credits_sold || ' créditos'),
                 'amount', coalesce(v.total_amount_brl, 0)
               )
          from public.server_credit_sales v
          join tenant t on t.tenant_id = v.tenant_id
          cross join sp
          left join public.reseller_servers rsv on rsv.id = v.reseller_server_id
          left join public.resellers rs on rs.id = rsv.reseller_id
          left join public.servers s on s.id = v.server_id
         where v.created_at >= sp.month_start_ts
        union all
        -- aplicativos (mesma regra de apps_daily)
        select jsonb_build_object(
                 'at', coalesce(p.paid_at, p.created_at),
                 'day', (coalesce(p.paid_at, p.created_at) at time zone 'America/Sao_Paulo')::date,
                 'kind', 'app',
                 'name', coalesce(c.display_name, 'Cliente'),
                 'detail', coalesce(p.app_name_snapshot, case when p.payment_type = 'subscription' then 'Apps junto da mensalidade' else 'Aplicativo' end),
                 'amount', round(case upper(coalesce(p.price_currency, 'BRL'))
                             when 'USD' then p.app_amount * fx.usd
                             when 'EUR' then p.app_amount * fx.eur
                             else p.app_amount end, 2)
               )
          from (
            select p1.*,
                   case
                     when p1.payment_type = 'pending_charge' then greatest(coalesce(p1.price_amount, 0) - coalesce(p1.plan_price_amount, 0), 0)
                     when p1.payment_type = 'subscription' then coalesce((
                       select sum(al.amount) from public.client_alerts al
                        where al.id = any(p1.settled_alert_ids) and al.kind = 'app_activation'), 0)
                     else coalesce(p1.price_amount, 0)
                   end as app_amount
              from public.client_portal_payments p1
             where p1.status in ('approved', 'manual_approved')
               and (p1.payment_type = 'app_renewal'
                 or (p1.payment_type = 'pending_charge' and coalesce(p1.price_amount, 0) - coalesce(p1.plan_price_amount, 0) > 0)
                 or (p1.payment_type = 'subscription' and exists (
                       select 1 from public.client_alerts al
                        where al.id = any(p1.settled_alert_ids) and al.kind = 'app_activation')))
          ) p
          join tenant t on t.tenant_id = p.tenant_id
          cross join sp
          cross join fx
          left join public.clients c on c.id = p.client_id
         where coalesce(p.paid_at, p.created_at) >= sp.month_start_ts
      ) q
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_dashboard_month_details() from public, anon;
grant execute on function public.get_dashboard_month_details() to authenticated;
