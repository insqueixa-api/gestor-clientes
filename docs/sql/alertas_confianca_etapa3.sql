-- =====================================================================
-- 02/10/2026 — Alertas "em confiança", etapa 3 (docs/alertas-confianca/PLANO.md)
-- "Pagar só a pendência" no portal: um pagamento online que NÃO renova a
-- assinatura e NÃO gasta crédito — só quita os sinos.
-- =====================================================================

-- 1) tipo novo de pagamento
alter table public.client_portal_payments drop constraint if exists client_portal_payments_payment_type_check;
alter table public.client_portal_payments add constraint client_portal_payments_payment_type_check
  check (payment_type = any (array['subscription'::text, 'app_renewal'::text, 'pending_charge'::text]));

-- ---------------------------------------------------------------------
-- 2) settle_portal_payment_alerts: baixa dos sinos de um pagamento do
-- portal APROVADO. Chamado pelo runFulfillment (service role) nos 2 casos:
--   • pending_charge (só a pendência): renewal_trust → client_renewals PAID
--     (sem crédito — já foi gasto na renovação em confiança); marca o
--     pagamento como concluído. Nunca renova nada.
--   • subscription (mensalidade + pendência): só fecha os sinos e registra o
--     uso dos cupons dos sinos (o valor já entra no client_renewals da
--     renovação normal).
-- Idempotente: sino já fechado é pulado (volta em "skipped" — se o sino foi
-- fechado por outro caminho antes, é possível pagamento em dobro e o app
-- avisa o admin). Trava o pagamento e cada sino (FOR UPDATE), então corre
-- em fila com o 👍 do sino (settle_client_alert, que trava o mesmo sino).
-- ---------------------------------------------------------------------
create or replace function public.settle_portal_payment_alerts(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  p public.client_portal_payments%rowtype;
  a public.client_alerts%rowtype;
  c public.clients%rowtype;
  v_is_pending boolean;
  v_settled uuid[] := '{}';
  v_skipped uuid[] := '{}';
  v_months int;
  v_screens int;
  v_disc numeric;
  v_currency text;
  v_renewal_date text;
begin
  select * into p from public.client_portal_payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;
  if p.status not in ('approved', 'manual_approved') then
    raise exception 'PAYMENT_NOT_APPROVED';
  end if;
  v_is_pending := p.payment_type = 'pending_charge';
  if v_is_pending and p.fulfillment_status in ('done', 'manual_done') then
    return jsonb_build_object('ok', true, 'already_done', true);
  end if;

  select * into c from public.clients where id = p.client_id and tenant_id = p.tenant_id;
  if not found then
    raise exception 'CLIENT_NOT_FOUND';
  end if;

  for a in
    select * from public.client_alerts
     where id = any(coalesce(p.settled_alert_ids, '{}'::uuid[]))
       and tenant_id = p.tenant_id and client_id = p.client_id
     order by created_at
     for update
  loop
    if a.status <> 'OPEN' then
      v_skipped := v_skipped || a.id;
      continue;
    end if;
    v_currency := upper(coalesce(a.currency, c.price_currency::text, 'BRL'));

    if v_is_pending and a.kind = 'renewal_trust' and coalesce(a.amount, 0) > 0 then
      v_months := greatest(coalesce((a.meta->>'months')::int, 1), 1);
      v_screens := greatest(coalesce((a.meta->>'screens')::int, c.screens, 1), 1);
      v_renewal_date := coalesce(a.meta->>'renewal_date', to_char(a.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'));
      insert into public.client_renewals (
        tenant_id, client_id, server_id, created_at, months, screens, currency,
        unit_price, total_amount, credits_per_month, credits_used, status, notes
      ) values (
        p.tenant_id, c.id, c.server_id, now(), v_months, v_screens, v_currency::public.currency_code,
        round(a.amount / v_months, 6), a.amount,
        case when v_months in (1, 2, 3, 6, 12) then v_months else 1 end,
        v_months * v_screens, 'PAID',
        'Renovação em confiança de ' || to_char(v_renewal_date::date, 'DD/MM/YYYY')
          || ' · paga no portal em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
          || ' · ' || coalesce(c.display_name, '') || ' (' || coalesce(c.server_username, '') || ')'
          || ' · ' || v_months || ' mês(es) · ' || v_screens || ' tela(s)'
      );
    end if;

    -- uso do cupom do sino (UNIQUE coupon+cliente: nunca duplica)
    if a.coupon_id is not null then
      v_disc := nullif(coalesce((a.meta->>'discount_amount')::numeric, 0), 0);
      if v_disc is not null then
        insert into public.coupon_redemptions (tenant_id, coupon_id, client_id, payment_id, discount_amount, currency)
        values (p.tenant_id, a.coupon_id, c.id, p.id, v_disc, v_currency)
        on conflict (coupon_id, client_id) do nothing;
      end if;
      update public.coupons set is_active = false where id = a.coupon_id and client_id is not null;
    end if;

    update public.client_alerts set status = 'CLOSED', closed_at = now() where id = a.id;
    v_settled := v_settled || a.id;
  end loop;

  if v_is_pending then
    update public.client_portal_payments
       set fulfillment_status = 'done', fulfilled_at = now(), fulfilled_automatically = true,
           fulfillment_error = null, paid_at = coalesce(paid_at, now()), whatsapp_status = coalesce(whatsapp_status, 'na')
     where id = p.id;
  end if;

  return jsonb_build_object('ok', true, 'settled', to_jsonb(v_settled), 'skipped', to_jsonb(v_skipped));
end $$;

revoke all on function public.settle_portal_payment_alerts(uuid) from public, anon, authenticated;
grant execute on function public.settle_portal_payment_alerts(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 3) Painéis: o pagamento só da pendência entra em "Aplicativos" pela parte
-- que não é renovação em confiança (price_amount - plan_price_amount); a
-- parte da renovação já entra em client_renewals pela função acima.
-- ---------------------------------------------------------------------
create or replace view public.vw_dashboard_finance_cards with (security_invoker = true) as
WITH fx AS (
         SELECT tm.tenant_id,
            COALESCE(f.usd_to_brl, 5::numeric) AS usd_to_brl,
            COALESCE(f.eur_to_brl, 6::numeric) AS eur_to_brl
           FROM tenant_members tm
             LEFT JOIN tenant_fx_rates f ON f.tenant_id = tm.tenant_id
          WHERE tm.user_id = auth.uid()
        ), sp AS (
         SELECT (now() AT TIME ZONE 'America/Sao_Paulo'::text)::date AS today,
            date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text))::date AS month_start,
            (date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text)) + '1 mon'::interval - '1 day'::interval)::date AS month_end,
            (date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text)) - '1 mon'::interval)::date AS prev_month_start,
            (date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text)) - '1 day'::interval)::date AS prev_month_end
        ), renewals_amount_daily AS (
         SELECT r.tenant_id,
            (r.created_at AT TIME ZONE 'America/Sao_Paulo'::text)::date AS day,
            count(*) AS qty,
            sum(COALESCE(r.total_amount, 0::numeric)) AS amount_brl_estimated
           FROM client_renewals r
          GROUP BY r.tenant_id, ((r.created_at AT TIME ZONE 'America/Sao_Paulo'::text)::date)
        ), sales_daily AS (
         SELECT s.tenant_id,
            (s.created_at AT TIME ZONE 'America/Sao_Paulo'::text)::date AS day,
            count(*) AS qty,
            sum(COALESCE(s.total_amount_brl, 0::numeric)) AS amount_brl
           FROM server_credit_sales s
          GROUP BY s.tenant_id, ((s.created_at AT TIME ZONE 'America/Sao_Paulo'::text)::date)
        ), apps_daily AS (
         SELECT p.tenant_id,
            (COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Sao_Paulo'::text)::date AS day,
            count(*) AS qty,
            sum(
                CASE upper(COALESCE(p.price_currency, 'BRL'::text))
                    WHEN 'USD'::text THEN (CASE WHEN p.payment_type = 'pending_charge'::text THEN GREATEST(COALESCE(p.price_amount, 0::numeric) - COALESCE(p.plan_price_amount, 0::numeric), 0::numeric) ELSE COALESCE(p.price_amount, 0::numeric) END) * fx.usd_to_brl
                    WHEN 'EUR'::text THEN (CASE WHEN p.payment_type = 'pending_charge'::text THEN GREATEST(COALESCE(p.price_amount, 0::numeric) - COALESCE(p.plan_price_amount, 0::numeric), 0::numeric) ELSE COALESCE(p.price_amount, 0::numeric) END) * fx.eur_to_brl
                    ELSE (CASE WHEN p.payment_type = 'pending_charge'::text THEN GREATEST(COALESCE(p.price_amount, 0::numeric) - COALESCE(p.plan_price_amount, 0::numeric), 0::numeric) ELSE COALESCE(p.price_amount, 0::numeric) END)
                END) AS amount_brl
           FROM client_portal_payments p
             JOIN fx ON fx.tenant_id = p.tenant_id
          WHERE (p.payment_type = 'app_renewal'::text OR p.payment_type = 'pending_charge'::text AND (COALESCE(p.price_amount, 0::numeric) - COALESCE(p.plan_price_amount, 0::numeric)) > 0::numeric) AND (p.status = ANY (ARRAY['approved'::text, 'manual_approved'::text]))
          GROUP BY p.tenant_id, ((COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Sao_Paulo'::text)::date)
        ), to_receive AS (
         SELECT c.tenant_id,
            count(*) AS qty,
            sum(
                CASE COALESCE(c.price_currency, 'BRL'::currency_code)::text
                    WHEN 'BRL'::text THEN COALESCE(c.price_amount, 0::numeric)
                    WHEN 'USD'::text THEN COALESCE(c.price_amount, 0::numeric) * fx.usd_to_brl
                    WHEN 'EUR'::text THEN COALESCE(c.price_amount, 0::numeric) * fx.eur_to_brl
                    ELSE COALESCE(c.price_amount, 0::numeric)
                END) AS amount_brl_estimated
           FROM clients c
             JOIN fx ON fx.tenant_id = c.tenant_id
             CROSS JOIN sp
          WHERE c.is_archived = false AND COALESCE(c.is_trial, false) = false AND c.vencimento IS NOT NULL AND c.vencimento >= now() AND (c.vencimento AT TIME ZONE 'America/Sao_Paulo'::text)::date >= sp.month_start AND (c.vencimento AT TIME ZONE 'America/Sao_Paulo'::text)::date <= sp.month_end
          GROUP BY c.tenant_id
        )
 SELECT sp_row.tenant_id,
    COALESCE(( SELECT ra.qty
           FROM renewals_amount_daily ra
          WHERE ra.tenant_id = sp_row.tenant_id AND ra.day = sp_row.today), 0::bigint) AS clients_paid_today_qty,
    COALESCE(( SELECT ra.amount_brl_estimated
           FROM renewals_amount_daily ra
          WHERE ra.tenant_id = sp_row.tenant_id AND ra.day = sp_row.today), 0::numeric) AS clients_paid_today_brl_estimated,
    COALESCE(( SELECT sd.qty
           FROM sales_daily sd
          WHERE sd.tenant_id = sp_row.tenant_id AND sd.day = sp_row.today), 0::bigint) AS reseller_paid_today_qty,
    COALESCE(( SELECT sd.amount_brl
           FROM sales_daily sd
          WHERE sd.tenant_id = sp_row.tenant_id AND sd.day = sp_row.today), 0::numeric) AS reseller_paid_today_brl,
    COALESCE(( SELECT sum(ra.qty) AS sum
           FROM renewals_amount_daily ra
          WHERE ra.tenant_id = sp_row.tenant_id AND ra.day >= sp_row.month_start AND ra.day <= sp_row.month_end), 0::numeric) AS clients_paid_month_qty,
    COALESCE(( SELECT sum(ra.amount_brl_estimated) AS sum
           FROM renewals_amount_daily ra
          WHERE ra.tenant_id = sp_row.tenant_id AND ra.day >= sp_row.month_start AND ra.day <= sp_row.month_end), 0::numeric) AS clients_paid_month_brl_estimated,
    COALESCE(( SELECT sum(sd.qty) AS sum
           FROM sales_daily sd
          WHERE sd.tenant_id = sp_row.tenant_id AND sd.day >= sp_row.month_start AND sd.day <= sp_row.month_end), 0::numeric) AS reseller_paid_month_qty,
    COALESCE(( SELECT sum(sd.amount_brl) AS sum
           FROM sales_daily sd
          WHERE sd.tenant_id = sp_row.tenant_id AND sd.day >= sp_row.month_start AND sd.day <= sp_row.month_end), 0::numeric) AS reseller_paid_month_brl,
    COALESCE(( SELECT sum(ra.qty) AS sum
           FROM renewals_amount_daily ra
          WHERE ra.tenant_id = sp_row.tenant_id AND ra.day >= sp_row.prev_month_start AND ra.day <= sp_row.prev_month_end), 0::numeric) AS clients_paid_prev_month_qty,
    COALESCE(( SELECT sum(ra.amount_brl_estimated) AS sum
           FROM renewals_amount_daily ra
          WHERE ra.tenant_id = sp_row.tenant_id AND ra.day >= sp_row.prev_month_start AND ra.day <= sp_row.prev_month_end), 0::numeric) AS clients_paid_prev_month_brl_estimated,
    COALESCE(( SELECT sum(sd.qty) AS sum
           FROM sales_daily sd
          WHERE sd.tenant_id = sp_row.tenant_id AND sd.day >= sp_row.prev_month_start AND sd.day <= sp_row.prev_month_end), 0::numeric) AS reseller_paid_prev_month_qty,
    COALESCE(( SELECT sum(sd.amount_brl) AS sum
           FROM sales_daily sd
          WHERE sd.tenant_id = sp_row.tenant_id AND sd.day >= sp_row.prev_month_start AND sd.day <= sp_row.prev_month_end), 0::numeric) AS reseller_paid_prev_month_brl,
    COALESCE(tr.qty, 0::bigint) AS to_receive_clients_qty,
    COALESCE(tr.amount_brl_estimated, 0::numeric) AS to_receive_brl_estimated,
    COALESCE(( SELECT ad.qty
           FROM apps_daily ad
          WHERE ad.tenant_id = sp_row.tenant_id AND ad.day = sp_row.today), 0::bigint) AS apps_paid_today_qty,
    COALESCE(( SELECT ad.amount_brl
           FROM apps_daily ad
          WHERE ad.tenant_id = sp_row.tenant_id AND ad.day = sp_row.today), 0::numeric) AS apps_paid_today_brl,
    COALESCE(( SELECT sum(ad.qty) AS sum
           FROM apps_daily ad
          WHERE ad.tenant_id = sp_row.tenant_id AND ad.day >= sp_row.month_start AND ad.day <= sp_row.month_end), 0::numeric) AS apps_paid_month_qty,
    COALESCE(( SELECT sum(ad.amount_brl) AS sum
           FROM apps_daily ad
          WHERE ad.tenant_id = sp_row.tenant_id AND ad.day >= sp_row.month_start AND ad.day <= sp_row.month_end), 0::numeric) AS apps_paid_month_brl,
    COALESCE(( SELECT sum(ad.qty) AS sum
           FROM apps_daily ad
          WHERE ad.tenant_id = sp_row.tenant_id AND ad.day >= sp_row.prev_month_start AND ad.day <= sp_row.prev_month_end), 0::numeric) AS apps_paid_prev_month_qty,
    COALESCE(( SELECT sum(ad.amount_brl) AS sum
           FROM apps_daily ad
          WHERE ad.tenant_id = sp_row.tenant_id AND ad.day >= sp_row.prev_month_start AND ad.day <= sp_row.prev_month_end), 0::numeric) AS apps_paid_prev_month_brl
   FROM ( SELECT fx.tenant_id,
            sp.today,
            sp.month_start,
            sp.month_end,
            sp.prev_month_start,
            sp.prev_month_end
           FROM fx
             CROSS JOIN sp) sp_row
     LEFT JOIN to_receive tr ON tr.tenant_id = sp_row.tenant_id;

create or replace view public.vw_dashboard_payments_daily_current_month with (security_invoker = true) as
WITH sp AS (
         SELECT date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text))::date AS month_start_date,
            (now() AT TIME ZONE 'America/Sao_Paulo'::text)::date AS today_date,
            (date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text)) AT TIME ZONE 'America/Sao_Paulo'::text) AS month_start_ts
        ), days AS (
         SELECT generate_series(sp.month_start_date::timestamp without time zone, sp.today_date::timestamp without time zone, '1 day'::interval)::date AS day
           FROM sp
        ), client_daily AS (
         SELECT r.tenant_id,
            (r.created_at AT TIME ZONE 'America/Sao_Paulo'::text)::date AS day,
            sum(COALESCE(r.total_amount, 0::numeric)) AS amount_brl_estimated
           FROM client_renewals r
             CROSS JOIN sp
          WHERE r.created_at >= sp.month_start_ts
          GROUP BY r.tenant_id, ((r.created_at AT TIME ZONE 'America/Sao_Paulo'::text)::date)
        ), reseller_daily AS (
         SELECT s.tenant_id,
            (s.created_at AT TIME ZONE 'America/Sao_Paulo'::text)::date AS day,
            sum(COALESCE(s.total_amount_brl, 0::numeric)) AS amount_brl
           FROM server_credit_sales s
             CROSS JOIN sp
          WHERE s.created_at >= sp.month_start_ts
          GROUP BY s.tenant_id, ((s.created_at AT TIME ZONE 'America/Sao_Paulo'::text)::date)
        ), apps_daily AS (
         SELECT p.tenant_id,
            (COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Sao_Paulo'::text)::date AS day,
            sum(
                CASE upper(COALESCE(p.price_currency, 'BRL'::text))
                    WHEN 'USD'::text THEN (CASE WHEN p.payment_type = 'pending_charge'::text THEN GREATEST(COALESCE(p.price_amount, 0::numeric) - COALESCE(p.plan_price_amount, 0::numeric), 0::numeric) ELSE COALESCE(p.price_amount, 0::numeric) END) * COALESCE(f.usd_to_brl, 5::numeric)
                    WHEN 'EUR'::text THEN (CASE WHEN p.payment_type = 'pending_charge'::text THEN GREATEST(COALESCE(p.price_amount, 0::numeric) - COALESCE(p.plan_price_amount, 0::numeric), 0::numeric) ELSE COALESCE(p.price_amount, 0::numeric) END) * COALESCE(f.eur_to_brl, 6::numeric)
                    ELSE (CASE WHEN p.payment_type = 'pending_charge'::text THEN GREATEST(COALESCE(p.price_amount, 0::numeric) - COALESCE(p.plan_price_amount, 0::numeric), 0::numeric) ELSE COALESCE(p.price_amount, 0::numeric) END)
                END) AS amount_brl
           FROM client_portal_payments p
             LEFT JOIN tenant_fx_rates f ON f.tenant_id = p.tenant_id
             CROSS JOIN sp
          WHERE (p.payment_type = 'app_renewal'::text OR p.payment_type = 'pending_charge'::text AND (COALESCE(p.price_amount, 0::numeric) - COALESCE(p.plan_price_amount, 0::numeric)) > 0::numeric) AND (p.status = ANY (ARRAY['approved'::text, 'manual_approved'::text])) AND COALESCE(p.paid_at, p.created_at) >= sp.month_start_ts
          GROUP BY p.tenant_id, ((COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Sao_Paulo'::text)::date)
        )
 SELECT tm.tenant_id,
    d.day,
    COALESCE(cd.amount_brl_estimated, 0::numeric) AS clients_paid_brl_estimated,
    COALESCE(rd.amount_brl, 0::numeric) AS reseller_paid_brl,
    COALESCE(ad.amount_brl, 0::numeric) AS apps_paid_brl
   FROM ( SELECT DISTINCT tenant_members.tenant_id
           FROM tenant_members
          WHERE tenant_members.user_id = auth.uid()) tm
     CROSS JOIN days d
     LEFT JOIN client_daily cd ON cd.tenant_id = tm.tenant_id AND cd.day = d.day
     LEFT JOIN reseller_daily rd ON rd.tenant_id = tm.tenant_id AND rd.day = d.day
     LEFT JOIN apps_daily ad ON ad.tenant_id = tm.tenant_id AND ad.day = d.day
  ORDER BY d.day;
