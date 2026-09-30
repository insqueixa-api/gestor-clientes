-- =====================================================================
-- Fix: receita duplicada em renovações manuais (Elite e fallbacks)
--      + aplicativos entrando no "Recebidos" (junto com Revenda)
-- Achado 30/09/2026 (Márcio: "Recebidos Hoje" dizia 6 pagamentos / R$270,
-- o Log do Portal só tinha 4 / R$175).
--
-- Causa: quando o pagamento do portal cai no fluxo manual
-- (lib/client-portal/fulfillment.ts → notifyManual), grava uma linha
-- client_renewals status='PENDING' com "Ref: <mp_payment_id> ·" nas notas.
-- Ao concluir pela Auditoria (tela de Renovar), renew_client_and_log gravava
-- OUTRA linha 'PAID' e a PENDING nunca saía. vw_dashboard_finance_cards e
-- syncIptvRendimentos ("IPTV - Rendimentos") somam client_renewals sem olhar
-- status → todo pagamento Elite contava 2x. Jun–set/2026: 55 pares, R$2.865.
--
-- Regra nova (pedido do Márcio): pagamento recebido e confirmado JÁ é
-- recebido. Concluir a pendência só muda a linha de PENDING → PAID (mantém
-- a data do recebimento), nunca cria outra.
--
-- Rodar no SQL Editor do Supabase, na ordem (partes 1 → 4).
-- =====================================================================


-- ---------------------------------------------------------------------
-- PARTE 1 — concluir pendência = virar a linha PENDING em PAID
-- ---------------------------------------------------------------------
-- Interna (sem checagem de auth própria): só é chamada por
-- update_fulfillment_status, que já valida o tenant.
--
-- Se o admin concluiu pela tela de Renovar, o renew_client_and_log acabou
-- de gravar uma PAID (com créditos/meses/telas certos) — os dados dela são
-- copiados pra PENDING e ela é apagada. Se foi só "Marcar como Concluído",
-- não existe PAID nova: a PENDING só muda de status.
-- O valor recebido (total_amount) e a data (created_at) da PENDING ficam.
create or replace function public._settle_pending_client_renewal(
  p_tenant_id uuid,
  p_payment_log_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_client_id uuid;
  v_ref text;
  v_pend public.client_renewals%rowtype;
  v_paid public.client_renewals%rowtype;
begin
  select cp.client_id, nullif(btrim(cp.mp_payment_id::text), '')
    into v_client_id, v_ref
  from public.client_portal_payments cp
  where cp.id = p_payment_log_id and cp.tenant_id = p_tenant_id;

  if v_client_id is null or v_ref is null then
    return 0;
  end if;

  select * into v_pend
  from public.client_renewals r
  where r.tenant_id = p_tenant_id
    and r.client_id = v_client_id
    and r.status = 'PENDING'
    and r.notes like '%Ref: ' || v_ref || ' ·%'
  order by r.created_at desc
  limit 1;

  if not found then
    return 0;
  end if;

  select * into v_paid
  from public.client_renewals r
  where r.tenant_id = p_tenant_id
    and r.client_id = v_client_id
    and r.status = 'PAID'
    and r.created_at >= v_pend.created_at
    and r.created_at >= now() - interval '15 minutes'
  order by r.created_at desc
  limit 1;

  if found then
    update public.client_renewals r
    set status = 'PAID',
        server_id = v_paid.server_id,
        months = v_paid.months,
        screens = v_paid.screens,
        credits_per_month = v_paid.credits_per_month,
        credits_used = v_paid.credits_used,
        notes = replace(v_pend.notes, '[RENOVAÇÃO MANUAL PENDENTE]', '[RENOVAÇÃO MANUAL CONCLUÍDA]')
                || ' · Concluída: ' || coalesce(v_paid.notes, '')
    where r.id = v_pend.id;

    delete from public.client_renewals r where r.id = v_paid.id;
  else
    update public.client_renewals r
    set status = 'PAID',
        notes = replace(v_pend.notes, '[RENOVAÇÃO MANUAL PENDENTE]', '[RENOVAÇÃO MANUAL CONCLUÍDA]')
    where r.id = v_pend.id;
  end if;

  return 1;
end;
$$;

revoke all on function public._settle_pending_client_renewal(uuid, uuid) from public, anon, authenticated;

-- Mesma assinatura/comportamento de antes + o acerto acima quando conclui.
create or replace function public.update_fulfillment_status(p_log_id uuid, p_tenant_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.client_portal_payments
  set
    fulfillment_status = p_status,
    fulfilled_at = case
      when p_status in ('done', 'manual_done') then now()
      else fulfilled_at
    end,
    updated_at = now()
  where id = p_log_id and tenant_id = p_tenant_id;

  if p_status = 'manual_done' then
    perform public._settle_pending_client_renewal(p_tenant_id, p_log_id);
  end if;
end;
$$;

-- Remove a função da 1ª versão deste fix, se chegou a ser criada
drop function if exists public.consume_pending_client_renewal(uuid, uuid);


-- ---------------------------------------------------------------------
-- PARTE 2 — limpeza do histórico (junho → setembro/2026)
-- ---------------------------------------------------------------------
-- Mesmo acerto da parte 1, retroativo: cada PENDING que teve uma PAID do
-- mesmo cliente em até 2 dias depois vira PAID (com os dados da PAID) e a
-- PAID duplicada sai. Sobram PENDING só as nunca concluídas (testes de
-- R$1/R$2), que continuam contando como recebidas.

create table public._bkp_renewal_dup_pairs_20260930 as
select distinct on (pe.id)
  pe.id as pending_id,
  pa.id as paid_id,
  pe.tenant_id,
  pa.created_at as paid_created_at,
  pa.total_amount as paid_amount
from public.client_renewals pe
join public.client_renewals pa
  on pa.tenant_id = pe.tenant_id
 and pa.client_id = pe.client_id
 and pa.status = 'PAID'
 and pa.created_at >= pe.created_at
 and pa.created_at <= pe.created_at + interval '2 days'
where pe.status = 'PENDING'
order by pe.id, pa.created_at;

create table public._bkp_client_renewals_20260930 as
select r.* from public.client_renewals r
where r.id in (select pending_id from public._bkp_renewal_dup_pairs_20260930
               union select paid_id from public._bkp_renewal_dup_pairs_20260930);

alter table public._bkp_renewal_dup_pairs_20260930 enable row level security;
alter table public._bkp_client_renewals_20260930 enable row level security;

-- Trava: uma PAID nunca pode "fechar" duas PENDING
do $$
begin
  if exists (select paid_id from public._bkp_renewal_dup_pairs_20260930
             group by paid_id having count(*) > 1) then
    raise exception 'PAID casada com mais de uma PENDING — revisar antes de continuar';
  end if;
end $$;

-- Conferência (esperado em 30/09/2026: 55 pares, R$ 2.865,00 —
-- jun 95 / jul 840 / ago 890 / set 1.040)
select to_char(paid_created_at at time zone 'America/Sao_Paulo', 'YYYY-MM') as mes,
       count(*) as pares, sum(paid_amount) as valor_duplicado
from public._bkp_renewal_dup_pairs_20260930
group by rollup(1) order by 1;

update public.client_renewals pe
set status = 'PAID',
    server_id = pa.server_id,
    months = pa.months,
    screens = pa.screens,
    credits_per_month = pa.credits_per_month,
    credits_used = pa.credits_used,
    notes = replace(pe.notes, '[RENOVAÇÃO MANUAL PENDENTE]', '[RENOVAÇÃO MANUAL CONCLUÍDA]')
            || ' · Concluída: ' || coalesce(pa.notes, '')
from public._bkp_renewal_dup_pairs_20260930 d
join public._bkp_client_renewals_20260930 pa on pa.id = d.paid_id
where pe.id = d.pending_id;

-- Tira do "IPTV - Rendimentos" de cada mês exatamente o valor da PAID
-- duplicada (subtração, não recálculo — meses antigos foram sincronizados
-- com regras de janela diferentes; não mexe em nada além do erro).
update public.fin_transacoes t
set valor = t.valor - d.valor_dup
from (
  select tenant_id,
         date_trunc('month', paid_created_at at time zone 'America/Sao_Paulo') as mes,
         sum(paid_amount) as valor_dup
  from public._bkp_renewal_dup_pairs_20260930
  group by 1, 2
) d
where t.descricao = 'IPTV - Rendimentos'
  and t.tenant_id = d.tenant_id
  and date_trunc('month', t.data_vencimento at time zone 'America/Sao_Paulo') = d.mes;

delete from public.client_renewals r
using public._bkp_renewal_dup_pairs_20260930 d
where r.id = d.paid_id;


-- ---------------------------------------------------------------------
-- PARTE 3 — data em que o pagamento foi confirmado (paid_at)
-- ---------------------------------------------------------------------
-- client_portal_payments.created_at é quando o PIX foi GERADO, não pago.
-- O trigger carimba paid_at na 1ª vez que o status vira aprovado, em
-- qualquer caminho (webhook MP/Stripe/FastDePix, polling, aprovação manual
-- de transferência, linha filha de app embutido) — sem depender do código.
alter table public.client_portal_payments add column if not exists paid_at timestamptz;

create or replace function public._client_portal_payments_set_paid_at()
returns trigger
language plpgsql
as $$
begin
  if new.status::text in ('approved', 'manual_approved') and new.paid_at is null then
    new.paid_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_client_portal_payments_paid_at on public.client_portal_payments;
create trigger trg_client_portal_payments_paid_at
before insert or update of status on public.client_portal_payments
for each row execute function public._client_portal_payments_set_paid_at();

-- Histórico: melhor aproximação disponível (PIX expira em 30 min)
update public.client_portal_payments
set paid_at = created_at
where paid_at is null and status::text in ('approved', 'manual_approved');


-- ---------------------------------------------------------------------
-- PARTE 4 — aplicativos no vw_dashboard_finance_cards
-- ---------------------------------------------------------------------
-- Colunas novas no FIM (apps_paid_*), as antigas ficam idênticas. O painel
-- soma apps junto com Revenda. Guarda e reaplica as opções atuais da view
-- (ex: security_invoker) pra não mudar a segurança dela sem querer.
do $do$
declare
  v_opts text[];
begin
  select c.reloptions into v_opts
  from pg_class c where c.oid = 'public.vw_dashboard_finance_cards'::regclass;

  execute $v$
create or replace view public.vw_dashboard_finance_cards as
 WITH fx AS (
         SELECT tm.tenant_id,
            COALESCE(f.usd_to_brl, (5)::numeric) AS usd_to_brl,
            COALESCE(f.eur_to_brl, (6)::numeric) AS eur_to_brl
           FROM (tenant_members tm
             LEFT JOIN tenant_fx_rates f ON ((f.tenant_id = tm.tenant_id)))
          WHERE (tm.user_id = auth.uid())
        ), sp AS (
         SELECT ((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date AS today,
            (date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text)))::date AS month_start,
            (((date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text)) + '1 mon'::interval) - '1 day'::interval))::date AS month_end,
            ((date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text)) - '1 mon'::interval))::date AS prev_month_start,
            ((date_trunc('month'::text, (now() AT TIME ZONE 'America/Sao_Paulo'::text)) - '1 day'::interval))::date AS prev_month_end
        ), renewals_amount_daily AS (
         SELECT r.tenant_id,
            ((r.created_at AT TIME ZONE 'America/Sao_Paulo'::text))::date AS day,
            count(*) AS qty,
            sum(COALESCE(r.total_amount, (0)::numeric)) AS amount_brl_estimated
           FROM client_renewals r
          GROUP BY r.tenant_id, (((r.created_at AT TIME ZONE 'America/Sao_Paulo'::text))::date)
        ), sales_daily AS (
         SELECT s.tenant_id,
            ((s.created_at AT TIME ZONE 'America/Sao_Paulo'::text))::date AS day,
            count(*) AS qty,
            sum(COALESCE(s.total_amount_brl, (0)::numeric)) AS amount_brl
           FROM server_credit_sales s
          GROUP BY s.tenant_id, (((s.created_at AT TIME ZONE 'America/Sao_Paulo'::text))::date)
        ), apps_daily AS (
         SELECT p.tenant_id,
            ((COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Sao_Paulo'::text))::date AS day,
            count(*) AS qty,
            sum(
                CASE upper(COALESCE(p.price_currency::text, 'BRL'::text))
                    WHEN 'USD'::text THEN (COALESCE(p.price_amount, (0)::numeric) * fx.usd_to_brl)
                    WHEN 'EUR'::text THEN (COALESCE(p.price_amount, (0)::numeric) * fx.eur_to_brl)
                    ELSE COALESCE(p.price_amount, (0)::numeric)
                END) AS amount_brl
           FROM (client_portal_payments p
             JOIN fx ON ((fx.tenant_id = p.tenant_id)))
          WHERE ((p.payment_type::text = 'app_renewal'::text) AND (p.status::text = ANY (ARRAY['approved'::text, 'manual_approved'::text])))
          GROUP BY p.tenant_id, (((COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'America/Sao_Paulo'::text))::date)
        ), to_receive AS (
         SELECT c.tenant_id,
            count(*) AS qty,
            sum(
                CASE (COALESCE(c.price_currency, 'BRL'::currency_code))::text
                    WHEN 'BRL'::text THEN COALESCE(c.price_amount, (0)::numeric)
                    WHEN 'USD'::text THEN (COALESCE(c.price_amount, (0)::numeric) * fx.usd_to_brl)
                    WHEN 'EUR'::text THEN (COALESCE(c.price_amount, (0)::numeric) * fx.eur_to_brl)
                    ELSE COALESCE(c.price_amount, (0)::numeric)
                END) AS amount_brl_estimated
           FROM ((clients c
             JOIN fx ON ((fx.tenant_id = c.tenant_id)))
             CROSS JOIN sp)
          WHERE ((c.is_archived = false) AND (COALESCE(c.is_trial, false) = false) AND (c.vencimento IS NOT NULL) AND (c.vencimento >= now()) AND (((c.vencimento AT TIME ZONE 'America/Sao_Paulo'::text))::date >= sp.month_start) AND (((c.vencimento AT TIME ZONE 'America/Sao_Paulo'::text))::date <= sp.month_end))
          GROUP BY c.tenant_id
        )
 SELECT sp_row.tenant_id,
    COALESCE(( SELECT ra.qty FROM renewals_amount_daily ra
          WHERE ((ra.tenant_id = sp_row.tenant_id) AND (ra.day = sp_row.today))), (0)::bigint) AS clients_paid_today_qty,
    COALESCE(( SELECT ra.amount_brl_estimated FROM renewals_amount_daily ra
          WHERE ((ra.tenant_id = sp_row.tenant_id) AND (ra.day = sp_row.today))), (0)::numeric) AS clients_paid_today_brl_estimated,
    COALESCE(( SELECT sd.qty FROM sales_daily sd
          WHERE ((sd.tenant_id = sp_row.tenant_id) AND (sd.day = sp_row.today))), (0)::bigint) AS reseller_paid_today_qty,
    COALESCE(( SELECT sd.amount_brl FROM sales_daily sd
          WHERE ((sd.tenant_id = sp_row.tenant_id) AND (sd.day = sp_row.today))), (0)::numeric) AS reseller_paid_today_brl,
    COALESCE(( SELECT sum(ra.qty) AS sum FROM renewals_amount_daily ra
          WHERE ((ra.tenant_id = sp_row.tenant_id) AND (ra.day >= sp_row.month_start) AND (ra.day <= sp_row.month_end))), (0)::numeric) AS clients_paid_month_qty,
    COALESCE(( SELECT sum(ra.amount_brl_estimated) AS sum FROM renewals_amount_daily ra
          WHERE ((ra.tenant_id = sp_row.tenant_id) AND (ra.day >= sp_row.month_start) AND (ra.day <= sp_row.month_end))), (0)::numeric) AS clients_paid_month_brl_estimated,
    COALESCE(( SELECT sum(sd.qty) AS sum FROM sales_daily sd
          WHERE ((sd.tenant_id = sp_row.tenant_id) AND (sd.day >= sp_row.month_start) AND (sd.day <= sp_row.month_end))), (0)::numeric) AS reseller_paid_month_qty,
    COALESCE(( SELECT sum(sd.amount_brl) AS sum FROM sales_daily sd
          WHERE ((sd.tenant_id = sp_row.tenant_id) AND (sd.day >= sp_row.month_start) AND (sd.day <= sp_row.month_end))), (0)::numeric) AS reseller_paid_month_brl,
    COALESCE(( SELECT sum(ra.qty) AS sum FROM renewals_amount_daily ra
          WHERE ((ra.tenant_id = sp_row.tenant_id) AND (ra.day >= sp_row.prev_month_start) AND (ra.day <= sp_row.prev_month_end))), (0)::numeric) AS clients_paid_prev_month_qty,
    COALESCE(( SELECT sum(ra.amount_brl_estimated) AS sum FROM renewals_amount_daily ra
          WHERE ((ra.tenant_id = sp_row.tenant_id) AND (ra.day >= sp_row.prev_month_start) AND (ra.day <= sp_row.prev_month_end))), (0)::numeric) AS clients_paid_prev_month_brl_estimated,
    COALESCE(( SELECT sum(sd.qty) AS sum FROM sales_daily sd
          WHERE ((sd.tenant_id = sp_row.tenant_id) AND (sd.day >= sp_row.prev_month_start) AND (sd.day <= sp_row.prev_month_end))), (0)::numeric) AS reseller_paid_prev_month_qty,
    COALESCE(( SELECT sum(sd.amount_brl) AS sum FROM sales_daily sd
          WHERE ((sd.tenant_id = sp_row.tenant_id) AND (sd.day >= sp_row.prev_month_start) AND (sd.day <= sp_row.prev_month_end))), (0)::numeric) AS reseller_paid_prev_month_brl,
    COALESCE(tr.qty, (0)::bigint) AS to_receive_clients_qty,
    COALESCE(tr.amount_brl_estimated, (0)::numeric) AS to_receive_brl_estimated,
    COALESCE(( SELECT ad.qty FROM apps_daily ad
          WHERE ((ad.tenant_id = sp_row.tenant_id) AND (ad.day = sp_row.today))), (0)::bigint) AS apps_paid_today_qty,
    COALESCE(( SELECT ad.amount_brl FROM apps_daily ad
          WHERE ((ad.tenant_id = sp_row.tenant_id) AND (ad.day = sp_row.today))), (0)::numeric) AS apps_paid_today_brl,
    COALESCE(( SELECT sum(ad.qty) AS sum FROM apps_daily ad
          WHERE ((ad.tenant_id = sp_row.tenant_id) AND (ad.day >= sp_row.month_start) AND (ad.day <= sp_row.month_end))), (0)::numeric) AS apps_paid_month_qty,
    COALESCE(( SELECT sum(ad.amount_brl) AS sum FROM apps_daily ad
          WHERE ((ad.tenant_id = sp_row.tenant_id) AND (ad.day >= sp_row.month_start) AND (ad.day <= sp_row.month_end))), (0)::numeric) AS apps_paid_month_brl,
    COALESCE(( SELECT sum(ad.qty) AS sum FROM apps_daily ad
          WHERE ((ad.tenant_id = sp_row.tenant_id) AND (ad.day >= sp_row.prev_month_start) AND (ad.day <= sp_row.prev_month_end))), (0)::numeric) AS apps_paid_prev_month_qty,
    COALESCE(( SELECT sum(ad.amount_brl) AS sum FROM apps_daily ad
          WHERE ((ad.tenant_id = sp_row.tenant_id) AND (ad.day >= sp_row.prev_month_start) AND (ad.day <= sp_row.prev_month_end))), (0)::numeric) AS apps_paid_prev_month_brl
   FROM (( SELECT fx.tenant_id, sp.today, sp.month_start, sp.month_end, sp.prev_month_start, sp.prev_month_end
           FROM (fx CROSS JOIN sp)) sp_row
     LEFT JOIN to_receive tr ON ((tr.tenant_id = sp_row.tenant_id)))
  $v$;

  if v_opts is not null then
    execute format('alter view public.vw_dashboard_finance_cards set (%s)', array_to_string(v_opts, ', '));
  end if;
end
$do$;

-- Conferência final (a view resolve o tenant por auth.uid(), então no SQL
-- Editor ela volta vazia — aqui é a mesma conta direto na tabela)
select to_char(coalesce(paid_at, created_at) at time zone 'America/Sao_Paulo', 'YYYY-MM') as mes,
       count(*) as apps_pagos, sum(price_amount) as valor
from public.client_portal_payments
where payment_type::text = 'app_renewal'
  and status::text in ('approved', 'manual_approved')
  and coalesce(paid_at, created_at) >= now() - interval '3 months'
group by 1 order by 1;
