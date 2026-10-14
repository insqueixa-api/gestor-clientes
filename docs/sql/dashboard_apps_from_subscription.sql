-- ✅ 14/10/2026: Dashboard conta como APPS a parte de pendência de aplicativo
-- (client_alerts kind=app_activation) quitada junto com a mensalidade —
-- antes ficava inteira em Clientes (client_renewals). Ver lib/client-portal/fulfillment.ts.
-- Correção dos registros antigos (João 14/10 e Robson 03/10) no fim do arquivo.

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
                    WHEN 'USD'::text THEN p.app_amount * fx.usd_to_brl
                    WHEN 'EUR'::text THEN p.app_amount * fx.eur_to_brl
                    ELSE p.app_amount
                END) AS amount_brl
           FROM ( SELECT p.tenant_id, p.paid_at, p.created_at, p.price_currency,
                    CASE
                        WHEN p.payment_type = 'pending_charge'::text THEN GREATEST(COALESCE(p.price_amount, 0::numeric) - COALESCE(p.plan_price_amount, 0::numeric), 0::numeric)
                        WHEN p.payment_type = 'subscription'::text THEN COALESCE(( SELECT sum(al.amount) FROM client_alerts al
                              WHERE al.id = ANY (p.settled_alert_ids) AND al.kind = 'app_activation'::text), 0::numeric)
                        ELSE COALESCE(p.price_amount, 0::numeric)
                    END AS app_amount
                   FROM client_portal_payments p
                  WHERE (p.status = ANY (ARRAY['approved'::text, 'manual_approved'::text]))
                    AND (p.payment_type = 'app_renewal'::text
                      OR p.payment_type = 'pending_charge'::text AND (COALESCE(p.price_amount, 0::numeric) - COALESCE(p.plan_price_amount, 0::numeric)) > 0::numeric
                      OR p.payment_type = 'subscription'::text AND EXISTS ( SELECT 1 FROM client_alerts al
                              WHERE al.id = ANY (p.settled_alert_ids) AND al.kind = 'app_activation'::text))) p
             JOIN fx ON fx.tenant_id = p.tenant_id
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
                    WHEN 'USD'::text THEN p.app_amount * COALESCE(f.usd_to_brl, 5::numeric)
                    WHEN 'EUR'::text THEN p.app_amount * COALESCE(f.eur_to_brl, 6::numeric)
                    ELSE p.app_amount
                END) AS amount_brl
           FROM ( SELECT p.tenant_id, p.paid_at, p.created_at, p.price_currency,
                    CASE
                        WHEN p.payment_type = 'pending_charge'::text THEN GREATEST(COALESCE(p.price_amount, 0::numeric) - COALESCE(p.plan_price_amount, 0::numeric), 0::numeric)
                        WHEN p.payment_type = 'subscription'::text THEN COALESCE(( SELECT sum(al.amount) FROM client_alerts al
                              WHERE al.id = ANY (p.settled_alert_ids) AND al.kind = 'app_activation'::text), 0::numeric)
                        ELSE COALESCE(p.price_amount, 0::numeric)
                    END AS app_amount
                   FROM client_portal_payments p
                  WHERE (p.status = ANY (ARRAY['approved'::text, 'manual_approved'::text]))
                    AND (p.payment_type = 'app_renewal'::text
                      OR p.payment_type = 'pending_charge'::text AND (COALESCE(p.price_amount, 0::numeric) - COALESCE(p.plan_price_amount, 0::numeric)) > 0::numeric
                      OR p.payment_type = 'subscription'::text AND EXISTS ( SELECT 1 FROM client_alerts al
                              WHERE al.id = ANY (p.settled_alert_ids) AND al.kind = 'app_activation'::text))) p
             LEFT JOIN tenant_fx_rates f ON f.tenant_id = p.tenant_id
             CROSS JOIN sp
          WHERE COALESCE(p.paid_at, p.created_at) >= sp.month_start_ts
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

-- renovação que quitou sino de APP junto: a parte do app sai de client_renewals
with pays as (
  select p.id, p.client_id, p.paid_at, p.price_amount,
         (select sum(al.amount) from client_alerts al where al.id = any(p.settled_alert_ids) and al.kind = 'app_activation') app_part
    from client_portal_payments p
   where p.payment_type = 'subscription' and p.status in ('approved','manual_approved')
     and exists (select 1 from client_alerts al where al.id = any(p.settled_alert_ids) and al.kind = 'app_activation')
), alvo as (
  select r.id rid, pays.app_part, r.total_amount, r.months
    from pays
    join client_renewals r on r.client_id = pays.client_id
     and r.total_amount = pays.price_amount
     and abs(extract(epoch from (r.created_at - pays.paid_at))) < 600
)
update client_renewals r
   set total_amount = alvo.total_amount - alvo.app_part,
       unit_price = round((alvo.total_amount - alvo.app_part) / greatest(alvo.months, 1), 2),
       notes = r.notes || ' · (pendência de app R$ ' || alvo.app_part || ' contada em Apps)'
  from alvo
 where r.id = alvo.rid
returning r.client_id, r.created_at, alvo.total_amount antes, r.total_amount depois;
