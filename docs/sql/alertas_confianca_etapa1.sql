-- =====================================================================
-- 02/10/2026 — Alertas "em confiança", etapa 1 (docs/alertas-confianca/PLANO.md)
-- =====================================================================
-- client_alerts ganha:
--   kind      'app_activation' | 'renewal_trust' | 'note' | 'generic'
--             (null = antigo: deduzido como sempre — client_app_id = app,
--              sem amount = nota, senão genérico)
--   meta      renewal_trust: {period, plan_label, months, screens,
--             plan_table_id, renewal_date, client_app_id?}
--             app_activation: {full_amount, discount_amount, coupon_code}
--   coupon_id cupom pessoal criado junto (desconto já aplicado no amount)
alter table public.client_alerts
  add column if not exists kind text,
  add column if not exists meta jsonb,
  add column if not exists coupon_id uuid references public.coupons(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_alerts_kind_check') then
    alter table public.client_alerts add constraint client_alerts_kind_check
      check (kind is null or kind in ('app_activation', 'renewal_trust', 'note', 'generic'));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- settle_client_alert: baixa MANUAL (👍 no sino) — pagamento recebido por
-- fora (PIX/Revolut). Tudo numa transação: registra o pagamento, marca o
-- uso do cupom e fecha o sino. Idempotente: sino já fechado = não faz nada.
--   renewal_trust → client_renewals PAID (data da baixa; a renovação em si
--                   aconteceu em meta.renewal_date) + linha manual no Log
--   app_activation→ linha app_renewal manual no Log (conta em Aplicativos)
--   generic/note  → só fecha (como sempre foi)
-- Forma: moeda do cliente BRL → pix_manual; EUR/USD → Revolut (manual).
-- ---------------------------------------------------------------------
create or replace function public.settle_client_alert(p_tenant_id uuid, p_alert_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a public.client_alerts%rowtype;
  c public.clients%rowtype;
  v_kind text;
  v_meta jsonb;
  v_amount numeric;
  v_currency text;
  v_gateway text;
  v_payment_id uuid;
  v_renewal_id uuid;
  v_months int;
  v_screens int;
  v_discount numeric;
  v_coupon_code text;
  v_app_name text;
  v_renewal_date text;
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into a from public.client_alerts
   where id = p_alert_id and tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'ALERT_NOT_FOUND';
  end if;
  if a.status <> 'OPEN' then
    return jsonb_build_object('ok', true, 'already_closed', true);
  end if;

  v_kind := coalesce(
    a.kind,
    case when a.amount is null then 'note' when a.client_app_id is not null then 'app_activation' else 'generic' end
  );
  v_meta := coalesce(a.meta, '{}'::jsonb);
  v_amount := coalesce(a.amount, 0);

  if v_kind in ('renewal_trust', 'app_activation') and v_amount > 0 then
    select * into c from public.clients where id = a.client_id and tenant_id = p_tenant_id;
    if not found then
      raise exception 'CLIENT_NOT_FOUND';
    end if;
    v_currency := upper(coalesce(a.currency, c.price_currency::text, 'BRL'));
    -- forma (PIX x Revolut) segue a moeda DO CLIENTE (pedido do Márcio)
    v_gateway := case upper(coalesce(c.price_currency::text, 'BRL')) when 'EUR' then 'transfer_manual_eur' when 'USD' then 'transfer_manual_usd' else 'pix_manual' end;
    v_discount := nullif(coalesce((v_meta->>'discount_amount')::numeric, 0), 0);
    v_coupon_code := case when a.coupon_id is not null then (select code from public.coupons where id = a.coupon_id) end;

    if v_kind = 'renewal_trust' then
      v_months := greatest(coalesce((v_meta->>'months')::int, 1), 1);
      v_screens := greatest(coalesce((v_meta->>'screens')::int, c.screens, 1), 1);
      v_renewal_date := coalesce(v_meta->>'renewal_date', to_char(a.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'));

      insert into public.client_renewals (
        tenant_id, client_id, server_id, created_at, months, screens, currency,
        unit_price, total_amount, credits_per_month, credits_used, status, notes
      ) values (
        p_tenant_id, c.id, c.server_id, now(), v_months, v_screens, v_currency::public.currency_code,
        round(v_amount / v_months, 6), v_amount,
        case when v_months in (1, 2, 3, 6, 12) then v_months else 1 end,
        v_months * v_screens, 'PAID',
        'Renovação em confiança de ' || to_char(v_renewal_date::date, 'DD/MM/YYYY')
          || ' · pagamento manual em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
          || ' · ' || coalesce(c.display_name, '') || ' (' || coalesce(c.server_username, '') || ')'
          || ' · ' || v_months || ' mês(es) · ' || v_screens || ' tela(s)'
      ) returning id into v_renewal_id;

      insert into public.client_portal_payments (
        tenant_id, client_id, gateway_type, payment_method, payment_type, period, plan_label,
        price_amount, plan_price_amount, price_currency, new_vencimento, status,
        fulfillment_status, fulfilled_at, whatsapp_status, settled_alert_ids, paid_at,
        coupon_id, coupon_code, coupon_discount_amount
      ) values (
        p_tenant_id, c.id, v_gateway, 'manual', 'subscription',
        coalesce(v_meta->>'period', 'MONTHLY'), coalesce(v_meta->>'plan_label', 'Mensal'),
        v_amount, v_amount, v_currency, c.vencimento, 'manual_approved',
        'manual_done', now(), 'na', array[a.id], now(),
        a.coupon_id, v_coupon_code, v_discount
      ) returning id into v_payment_id;
    else
      v_app_name := (select ap.name from public.client_apps ca join public.apps ap on ap.id = ca.app_id where ca.id = a.client_app_id);
      insert into public.client_portal_payments (
        tenant_id, client_id, gateway_type, payment_method, payment_type, client_app_id,
        app_name_snapshot, price_amount, price_currency, status, fulfillment_status,
        fulfilled_at, whatsapp_status, settled_alert_ids, paid_at,
        coupon_id, coupon_code, coupon_discount_amount
      ) values (
        p_tenant_id, c.id, v_gateway, 'manual', 'app_renewal', a.client_app_id,
        coalesce(v_app_name, 'Aplicativo'), v_amount, v_currency, 'manual_approved', 'manual_done',
        now(), 'na', array[a.id], now(),
        a.coupon_id, v_coupon_code, v_discount
      ) returning id into v_payment_id;
    end if;

    -- uso do cupom (UNIQUE coupon+cliente: nunca duplica)
    if a.coupon_id is not null and v_discount is not null then
      insert into public.coupon_redemptions (tenant_id, coupon_id, client_id, payment_id, discount_amount, currency)
      values (p_tenant_id, a.coupon_id, c.id, v_payment_id, v_discount, v_currency)
      on conflict (coupon_id, client_id) do nothing;
      update public.coupons set is_active = false where id = a.coupon_id and client_id is not null;
    end if;
  end if;

  update public.client_alerts set status = 'CLOSED', closed_at = now() where id = a.id;

  return jsonb_build_object(
    'ok', true, 'kind', v_kind, 'payment_id', v_payment_id, 'renewal_id', v_renewal_id
  );
end $$;

revoke all on function public.settle_client_alert(uuid, uuid) from public, anon;
grant execute on function public.settle_client_alert(uuid, uuid) to authenticated;
