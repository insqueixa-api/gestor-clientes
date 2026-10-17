-- ✅ 17/10/2026, pedido do Márcio: o card "Testes" do Dashboard contava
-- pelos eventos da linha do tempo (client_events), que SOMEM quando o teste é
-- deletado (FK on delete cascade). Teste que não fechou e foi deletado
-- sumia da conta e a conversão ficava inflada. Agora:
--   * trial_log: 1 linha por teste criado, que NÃO some no delete
--     (deleted_at marca); converted_at quando vira cliente.
--   * card conta por PESSOA (WhatsApp normalizado): 2 testes do mesmo número
--     no mês (ex: Tony, NaTV + Fast) = 1 teste; convertido se qualquer um
--     deles fechou.
--   * conversão = pessoas que fizeram teste NO MÊS e fecharam (nunca > 100%).
-- Só exibição/estatística: não mexe em cliente, pagamento ou renovação.

create table if not exists public.trial_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid not null,            -- sem FK de propósito: sobrevive ao delete
  server_id uuid,
  phone_key text,                     -- normalize_phone(whatsapp_username)
  created_at timestamptz not null default now(),
  converted_at timestamptz,
  deleted_at timestamptz
);
create unique index if not exists trial_log_client_uidx on public.trial_log (client_id);
create index if not exists trial_log_tenant_created_idx on public.trial_log (tenant_id, created_at);

alter table public.trial_log enable row level security;
drop policy if exists trial_log_select on public.trial_log;
create policy trial_log_select on public.trial_log
  for select to authenticated
  using (exists (select 1 from public.tenant_members tm where tm.tenant_id = trial_log.tenant_id and tm.user_id = auth.uid()));
revoke all on public.trial_log from anon;
grant select on public.trial_log to authenticated;

create or replace function public.trial_log_track()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.is_trial, false) then
      insert into trial_log (tenant_id, client_id, server_id, phone_key, created_at)
      values (new.tenant_id, new.id, new.server_id, nullif(normalize_phone(new.whatsapp_username), ''), now())
      on conflict (client_id) do nothing;
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if coalesce(old.is_trial, false) and not coalesce(new.is_trial, false) then
      update trial_log set converted_at = coalesce(converted_at, now()) where client_id = new.id;
    end if;
    if coalesce(new.is_trial, false) and (new.whatsapp_username is distinct from old.whatsapp_username or new.server_id is distinct from old.server_id) then
      update trial_log
         set phone_key = nullif(normalize_phone(new.whatsapp_username), ''), server_id = new.server_id
       where client_id = new.id;
    end if;
    return new;
  else -- DELETE
    update trial_log set deleted_at = now() where client_id = old.id and deleted_at is null;
    return old;
  end if;
exception when others then
  -- estatística nunca pode travar cadastro/conversão/exclusão
  raise warning 'trial_log_track: %', sqlerrm;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.trial_log_track() from public, anon, authenticated;

drop trigger if exists trg_clients_trial_log on public.clients;
create trigger trg_clients_trial_log
after insert or update of is_trial, whatsapp_username, server_id or delete on public.clients
for each row execute function public.trial_log_track();

-- histórico: testes que ainda existem (os deletados antes daqui se perderam)
insert into public.trial_log (tenant_id, client_id, server_id, phone_key, created_at, converted_at)
select e.tenant_id, e.client_id, c.server_id, nullif(normalize_phone(c.whatsapp_username), ''),
       min(e.created_at),
       (select min(v.created_at) from public.client_events v where v.client_id = e.client_id and v.event_type = 'TRIAL_CONVERTED')
  from public.client_events e
  join public.clients c on c.id = e.client_id
 where e.event_type = 'TRIAL_CREATED'
 group by e.tenant_id, e.client_id, c.server_id, c.whatsapp_username
on conflict (client_id) do nothing;
-- teste ainda ativo sem evento de criação (garantia)
insert into public.trial_log (tenant_id, client_id, server_id, phone_key, created_at)
select c.tenant_id, c.id, c.server_id, nullif(normalize_phone(c.whatsapp_username), ''), c.created_at
  from public.clients c
 where coalesce(c.is_trial, false)
on conflict (client_id) do nothing;

create or replace view public.vw_dashboard_kpis_current_month
with (security_invoker = true) as
WITH fx AS (
         SELECT tm.tenant_id,
            COALESCE(f.usd_to_brl, 5::numeric) AS usd_to_brl,
            COALESCE(f.eur_to_brl, 6::numeric) AS eur_to_brl
           FROM tenant_members tm
             LEFT JOIN tenant_fx_rates f ON f.tenant_id = tm.tenant_id
          WHERE tm.user_id = auth.uid()
        ), sp AS (
         SELECT (now() AT TIME ZONE 'America/Sao_Paulo'::text) AS now_ts,
            (now() AT TIME ZONE 'America/Sao_Paulo'::text)::date AS today_date
        ), clients_base AS (
         SELECT c.tenant_id,
            c.id,
            c.is_archived,
            c.vencimento,
            COALESCE(c.price_amount, 0::numeric) AS price_amount,
            COALESCE(c.price_currency, 'BRL'::currency_code) AS price_currency
           FROM clients c
          WHERE COALESCE(c.is_trial, false) = false
        ), clients_classified AS (
         SELECT cb.tenant_id,
            cb.id,
            cb.is_archived,
            cb.vencimento,
            cb.price_amount,
            cb.price_currency,
                CASE
                    WHEN cb.is_archived THEN 'ARCHIVED'::text
                    WHEN cb.vencimento IS NOT NULL AND ((cb.vencimento - '00:00:01'::interval) AT TIME ZONE 'America/Sao_Paulo'::text)::date < sp.today_date THEN 'OVERDUE'::text
                    ELSE 'ACTIVE'::text
                END AS computed_status
           FROM clients_base cb
             CROSS JOIN sp
        ), clients_money AS (
         SELECT cc.tenant_id,
            cc.computed_status,
            count(*) AS qty,
            sum(
                CASE cc.price_currency::text
                    WHEN 'BRL'::text THEN cc.price_amount
                    WHEN 'USD'::text THEN cc.price_amount * fx_1.usd_to_brl
                    WHEN 'EUR'::text THEN cc.price_amount * fx_1.eur_to_brl
                    ELSE cc.price_amount
                END) AS amount_brl_estimated
           FROM clients_classified cc
             JOIN fx fx_1 ON fx_1.tenant_id = cc.tenant_id
          WHERE cc.computed_status = ANY (ARRAY['ACTIVE'::text, 'OVERDUE'::text])
          GROUP BY cc.tenant_id, cc.computed_status
        ), trials_created AS (
         -- 1 por PESSOA (WhatsApp): 2 testes do mesmo número no mês contam 1;
         -- teste deletado continua contando (trial_log não some no delete)
         SELECT tl.tenant_id,
            count(DISTINCT COALESCE(tl.phone_key, tl.client_id::text)) AS trials_created_month
           FROM trial_log tl
             CROSS JOIN sp
          WHERE date_trunc('month'::text, (tl.created_at AT TIME ZONE 'America/Sao_Paulo'::text)) = date_trunc('month'::text, sp.now_ts)
          GROUP BY tl.tenant_id
        ), trials_active AS (
         SELECT c.tenant_id,
            count(*) AS trials_active_month
           FROM clients c
             CROSS JOIN sp
          WHERE c.is_archived = false AND COALESCE(c.is_trial, false) = true AND date_trunc('month'::text, (c.created_at AT TIME ZONE 'America/Sao_Paulo'::text)) = date_trunc('month'::text, sp.now_ts) AND (c.vencimento IS NULL OR ((c.vencimento - '00:00:01'::interval) AT TIME ZONE 'America/Sao_Paulo'::text)::date >= sp.today_date)
          GROUP BY c.tenant_id
        ), trials_converted AS (
         -- pessoas que fizeram teste no mês e fecharam (qualquer teste delas)
         SELECT tl.tenant_id,
            count(DISTINCT COALESCE(tl.phone_key, tl.client_id::text)) AS trials_converted_month
           FROM trial_log tl
             CROSS JOIN sp
          WHERE date_trunc('month'::text, (tl.created_at AT TIME ZONE 'America/Sao_Paulo'::text)) = date_trunc('month'::text, sp.now_ts)
            AND tl.converted_at IS NOT NULL
          GROUP BY tl.tenant_id
        )
 SELECT fx.tenant_id,
    COALESCE(( SELECT cm.qty
           FROM clients_money cm
          WHERE cm.tenant_id = fx.tenant_id AND cm.computed_status = 'ACTIVE'::text), 0::bigint) AS active_clients,
    COALESCE(( SELECT cm.amount_brl_estimated
           FROM clients_money cm
          WHERE cm.tenant_id = fx.tenant_id AND cm.computed_status = 'ACTIVE'::text), 0::numeric) AS active_mrr_brl_estimated,
    COALESCE(( SELECT cm.qty
           FROM clients_money cm
          WHERE cm.tenant_id = fx.tenant_id AND cm.computed_status = 'OVERDUE'::text), 0::bigint) AS overdue_clients,
    COALESCE(( SELECT cm.amount_brl_estimated
           FROM clients_money cm
          WHERE cm.tenant_id = fx.tenant_id AND cm.computed_status = 'OVERDUE'::text), 0::numeric) AS overdue_amount_brl_estimated,
    COALESCE(tc.trials_created_month, 0::bigint) AS trials_created_month,
    COALESCE(ta.trials_active_month, 0::bigint) AS trials_active_month,
    COALESCE(tcv.trials_converted_month, 0::bigint) AS trials_converted_month,
        CASE
            WHEN COALESCE(tc.trials_created_month, 0::bigint) = 0 THEN 0::numeric
            ELSE round(COALESCE(tcv.trials_converted_month, 0::bigint)::numeric / tc.trials_created_month::numeric * 100::numeric, 1)
        END AS trials_conversion_percent
   FROM fx
     LEFT JOIN trials_created tc ON tc.tenant_id = fx.tenant_id
     LEFT JOIN trials_active ta ON ta.tenant_id = fx.tenant_id
     LEFT JOIN trials_converted tcv ON tcv.tenant_id = fx.tenant_id;
