-- =====================================================================
-- 02/10/2026 — Alertas "em confiança", etapa 2 (docs/alertas-confianca/PLANO.md)
-- =====================================================================
-- renew_client_trust: "Renovar em confiança" do modal de renovação do admin.
-- Igual a renew_client_and_log, MENOS o registro financeiro:
--   ✔ atualiza o vencimento
--   ✔ desconta crédito do servidor quando é renovação manual (servidor sem
--     integração — na automática o painel desconta e o saldo vem do sync)
--   ✔ histórico do cliente (client_events) e do servidor (server_events)
--   ✔ cria o sino "renewal_trust" (amount = valor do plano, meta = período/
--     telas/data) — tudo na mesma transação
--   ✘ NÃO grava client_renewals nem linha no Log do Portal → não entra no
--     saldo. Entra quando o cliente pagar (portal) ou na baixa manual
--     (settle_client_alert, que grava client_renewals SEM descontar crédito).
create or replace function public.renew_client_trust(
  p_tenant_id uuid,
  p_client_id uuid,
  p_months integer,
  p_new_vencimento timestamptz,
  p_is_automatic boolean,
  p_amount numeric,
  p_currency text,
  p_plan_label text,
  p_plan_table_id uuid default null,
  p_notes text default null
)
returns table(alert_id uuid, new_vencimento timestamptz, credits_used numeric, balance numeric)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_server_id uuid;
  v_screens int;
  v_old timestamptz;
  v_plan_table_id uuid;
  v_period text;
  v_credits_base int;
  v_credits_used numeric(18,6);
  v_name text;
  v_alert_id uuid;
  v_balance numeric(18,6);
  v_msg text;
begin
  if p_months not in (1, 2, 3, 6, 12) then
    raise exception 'Meses inválidos: %. Use 1,2,3,6,12.', p_months;
  end if;
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'UNAUTHORIZED_TENANT';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'AMOUNT_INVALID';
  end if;
  if p_new_vencimento is null then
    raise exception 'VENCIMENTO_REQUIRED';
  end if;

  select c.server_id, c.screens, c.vencimento, coalesce(c.display_name, c.server_username, 'Cliente'), c.plan_table_id
    into v_server_id, v_screens, v_old, v_name, v_plan_table_id
  from public.clients c
  where c.id = p_client_id and c.tenant_id = p_tenant_id
  for update;
  if v_server_id is null then
    raise exception 'CLIENT_NOT_FOUND_OR_NO_SERVER';
  end if;

  v_period := case p_months when 1 then 'MONTHLY' when 2 then 'BIMONTHLY' when 3 then 'QUARTERLY'
                            when 6 then 'SEMIANNUAL' when 12 then 'ANNUAL' end;
  v_plan_table_id := coalesce(p_plan_table_id, v_plan_table_id);
  select pti.credits_base into v_credits_base
  from public.plan_table_items pti
  where pti.plan_table_id = v_plan_table_id and pti.period::text = v_period
  limit 1;
  v_credits_base := coalesce(v_credits_base, p_months);
  v_credits_used := v_credits_base * greatest(1, coalesce(v_screens, 1));

  if not coalesce(p_is_automatic, false) then
    update public.servers s
       set credits_available = s.credits_available - v_credits_used, updated_at = now()
     where s.id = v_server_id and s.tenant_id = p_tenant_id
       and s.credits_available >= v_credits_used;
    if not found then
      raise exception 'INSUFFICIENT_SERVER_CREDITS';
    end if;
    insert into public.server_events (tenant_id, server_id, event_type, message, meta)
    values (p_tenant_id, v_server_id, 'RENEWAL_DEBIT',
      format('Débito · Renovação em confiança %s · %s tela%s · %s créditos', v_name,
             greatest(1, coalesce(v_screens, 1)),
             case when greatest(1, coalesce(v_screens, 1)) = 1 then '' else 's' end, v_credits_used::int),
      jsonb_build_object('client_id', p_client_id, 'client_name', v_name, 'months', p_months,
                         'screens', v_screens, 'credits_used', v_credits_used, 'trust', true));
  end if;

  update public.clients c set vencimento = p_new_vencimento, updated_at = now()
   where c.id = p_client_id and c.tenant_id = p_tenant_id;

  v_msg := 'Renovação em confiança (aguardando pagamento) · ' || p_months || ' mês(es) · '
           || greatest(1, coalesce(v_screens, 1)) || ' tela(s) · '
           || to_char(p_amount, 'FM999G999G990D00') || ' ' || upper(coalesce(p_currency, 'BRL'))
           || case when coalesce(btrim(p_notes), '') <> '' then ' · Obs: ' || p_notes else '' end;

  insert into public.client_events (tenant_id, client_id, event_type, message, meta)
  values (p_tenant_id, p_client_id, 'RENEWAL', v_msg,
    jsonb_build_object('months', p_months, 'old_vencimento', v_old, 'new_vencimento', p_new_vencimento,
                       'screens', v_screens, 'credits_used', v_credits_used,
                       'is_automatic', coalesce(p_is_automatic, false), 'trust', true));

  insert into public.client_alerts (tenant_id, client_id, message, status, amount, currency, kind, meta)
  values (
    p_tenant_id, p_client_id,
    'Renovação em confiança: ' || coalesce(p_plan_label, 'Mensal') || ' · '
      || greatest(1, coalesce(v_screens, 1)) || ' tela' || case when greatest(1, coalesce(v_screens, 1)) = 1 then '' else 's' end
      || ' · dia ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
    'OPEN', p_amount, upper(coalesce(p_currency, 'BRL')), 'renewal_trust',
    jsonb_build_object('period', v_period, 'plan_label', coalesce(p_plan_label, 'Mensal'), 'months', p_months,
                       'screens', greatest(1, coalesce(v_screens, 1)), 'plan_table_id', v_plan_table_id,
                       'renewal_date', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'))
  ) returning id into v_alert_id;

  select coalesce(s.credits_available, 0) into v_balance from public.servers s where s.id = v_server_id;

  return query select v_alert_id, p_new_vencimento, v_credits_used, v_balance;
end $$;

revoke all on function public.renew_client_trust(uuid, uuid, integer, timestamptz, boolean, numeric, text, text, uuid, text) from public, anon;
grant execute on function public.renew_client_trust(uuid, uuid, integer, timestamptz, boolean, numeric, text, text, uuid, text) to authenticated;
