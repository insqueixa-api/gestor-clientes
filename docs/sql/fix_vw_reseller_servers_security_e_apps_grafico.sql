-- =====================================================================
-- 30/09/2026 — Security Advisor do Supabase (1 erro: "Security Definer
-- View" em public.vw_reseller_servers) + apps no gráfico diário.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PARTE 1 — vw_reseller_servers (CRÍTICO)
-- ---------------------------------------------------------------------
-- A view não tinha security_invoker → rodava com as permissões do dono
-- (postgres), ignorando RLS de reseller_servers/resellers/servers. Não tem
-- filtro de tenant e expõe server_username/server_password, e o papel
-- anon tinha SELECT nela: qualquer um com a chave pública (que vai no
-- navegador) lia login+senha de servidor de todas as revendas.
--
-- Com security_invoker, valem as policies *_select_by_tenant (authenticated
-- + tenant_members) das 3 tabelas — exatamente o que as 2 telas que usam a
-- view (app/admin/revendedor/[id]/page.tsx e recarga_revenda.tsx, ambas
-- logadas) precisam.
alter view public.vw_reseller_servers set (security_invoker = true);

revoke all on public.vw_reseller_servers from anon;
-- View só de leitura (join de 3 tabelas) — authenticated só precisa ler.
revoke insert, update, delete, truncate, references, trigger
  on public.vw_reseller_servers from authenticated;


-- ---------------------------------------------------------------------
-- PARTE 2 — renovação de app no gráfico diário de pagamentos
-- ---------------------------------------------------------------------
-- Mesma regra de apps_daily em vw_dashboard_finance_cards
-- (fix_client_renewals_pending_duplicado.sql): client_portal_payments
-- payment_type=app_renewal aprovado, pelo dia do paid_at, convertido pela
-- cotação do tenant. Coluna nova no FIM (apps_paid_brl); as antigas ficam
-- idênticas. Reaplica as opções atuais da view (security_invoker).
do $do$
declare
  v_opts text[];
begin
  select c.reloptions into v_opts
  from pg_class c where c.oid = 'public.vw_dashboard_payments_daily_current_month'::regclass;

  execute $v$
create or replace view public.vw_dashboard_payments_daily_current_month as
 WITH sp AS (
         SELECT (date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text)))::date AS month_start_date,
            ((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date AS today_date,
            (date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text)) AT TIME ZONE 'America/Sao_Paulo'::text) AS month_start_ts
        ), days AS (
         SELECT (generate_series((sp.month_start_date)::timestamp without time zone, (sp.today_date)::timestamp without time zone, '1 day'::interval))::date AS day
           FROM sp
        ), client_daily AS (
         SELECT r.tenant_id,
            ((r.created_at AT TIME ZONE 'America/Sao_Paulo'::text))::date AS day,
            sum(COALESCE(r.total_amount, (0)::numeric)) AS amount_brl_estimated
           FROM (client_renewals r
             CROSS JOIN sp)
          WHERE (r.created_at >= sp.month_start_ts)
          GROUP BY r.tenant_id, (((r.created_at AT TIME ZONE 'America/Sao_Paulo'::text))::date)
        ), reseller_daily AS (
         SELECT s.tenant_id,
            ((s.created_at AT TIME ZONE 'America/Sao_Paulo'::text))::date AS day,
            sum(COALESCE(s.total_amount_brl, (0)::numeric)) AS amount_brl
           FROM (server_credit_sales s
             CROSS JOIN sp)
          WHERE (s.created_at >= sp.month_start_ts)
          GROUP BY s.tenant_id, (((s.created_at AT TIME ZONE 'America/Sao_Paulo'::text))::date)
        ), apps_daily AS (
         SELECT p.tenant_id,
            ((COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Sao_Paulo'::text))::date AS day,
            sum(
                CASE upper(COALESCE(p.price_currency::text, 'BRL'::text))
                    WHEN 'USD'::text THEN (COALESCE(p.price_amount, (0)::numeric) * COALESCE(f.usd_to_brl, (5)::numeric))
                    WHEN 'EUR'::text THEN (COALESCE(p.price_amount, (0)::numeric) * COALESCE(f.eur_to_brl, (6)::numeric))
                    ELSE COALESCE(p.price_amount, (0)::numeric)
                END) AS amount_brl
           FROM ((client_portal_payments p
             LEFT JOIN tenant_fx_rates f ON ((f.tenant_id = p.tenant_id)))
             CROSS JOIN sp)
          WHERE ((p.payment_type::text = 'app_renewal'::text)
            AND (p.status::text = ANY (ARRAY['approved'::text, 'manual_approved'::text]))
            AND (COALESCE(p.paid_at, p.created_at) >= sp.month_start_ts))
          GROUP BY p.tenant_id, (((COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Sao_Paulo'::text))::date)
        )
 SELECT tm.tenant_id,
    d.day,
    COALESCE(cd.amount_brl_estimated, (0)::numeric) AS clients_paid_brl_estimated,
    COALESCE(rd.amount_brl, (0)::numeric) AS reseller_paid_brl,
    COALESCE(ad.amount_brl, (0)::numeric) AS apps_paid_brl
   FROM ((((( SELECT DISTINCT tenant_members.tenant_id
           FROM tenant_members
          WHERE (tenant_members.user_id = auth.uid())) tm
     CROSS JOIN days d)
     LEFT JOIN client_daily cd ON (((cd.tenant_id = tm.tenant_id) AND (cd.day = d.day))))
     LEFT JOIN reseller_daily rd ON (((rd.tenant_id = tm.tenant_id) AND (rd.day = d.day))))
     LEFT JOIN apps_daily ad ON (((ad.tenant_id = tm.tenant_id) AND (ad.day = d.day))))
  ORDER BY d.day
  $v$;

  if v_opts is not null then
    execute format('alter view public.vw_dashboard_payments_daily_current_month set (%s)', array_to_string(v_opts, ', '));
  end if;
end
$do$;
