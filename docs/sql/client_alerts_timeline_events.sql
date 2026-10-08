-- ✅ 08/10/2026, pedido do Márcio: a Linha do Tempo do cliente (client_events)
-- não mostrava renovação em confiança criada pelo sino, ativação de app nem a
-- QUITAÇÃO dessas pendências (manual 👍 ou pelo portal).
--
-- Gatilho em client_alerts, só pros kinds renewal_trust / app_activation:
--   • criou o sino   → TRUST_RENEWAL / APP_ACTIVATION
--   • fechou o sino  → PENDING_SETTLED (tem pagamento com esse sino em
--                      client_portal_payments.settled_alert_ids — as duas
--                      funções de quitação gravam o pagamento ANTES de fechar)
--                      ou PENDING_DISMISSED (fechado sem pagamento)
--
-- SÓ ESCREVE EVENTO (exibição). Nunca mexe em client_renewals,
-- client_portal_payments, saldo ou crédito. Sem risco de duplicar dinheiro.
-- Sem duplicar evento: cada um leva meta.alert_id e só entra se ainda não
-- existir aquele tipo pra aquele sino. renew_client_trust já grava o próprio
-- evento RENEWAL na mesma transação → aí o TRUST_RENEWAL não entra.
-- Ativação "paga na hora" (meta.received_now): 1 evento só, na criação.

create or replace function public.log_client_alert_timeline_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := new.kind;
  v_meta jsonb := coalesce(new.meta, '{}'::jsonb);
  v_money text;
  v_type text;
  v_msg text;
  v_pay record;
begin
  if v_kind not in ('renewal_trust', 'app_activation') or new.client_id is null then
    return new;
  end if;

  v_money := case when new.amount is null then null
                  else case coalesce(new.currency, 'BRL') when 'BRL' then 'R$ ' when 'EUR' then '€ ' when 'USD' then 'US$ '
                            else new.currency || ' ' end
                       || replace(to_char(new.amount, 'FM9999990.00'), '.', ',') end;

  if tg_op = 'INSERT' then
    if v_kind = 'renewal_trust' then
      -- renew_client_trust já gravou o RENEWAL dela nesta transação
      if exists (select 1 from client_events e
                  where e.client_id = new.client_id and e.created_at = now()) then
        return new;
      end if;
      v_type := 'TRUST_RENEWAL';
      v_msg := new.message || coalesce(' · ' || v_money, '') || ' · aguardando pagamento';
    else
      v_type := 'APP_ACTIVATION';
      v_msg := new.message || coalesce(' · ' || v_money, '')
               || case when (v_meta->>'received_now')::boolean is true then ' · pago na hora'
                       else ' · aguardando pagamento' end
               || coalesce(' · cupom ' || nullif(v_meta->>'coupon_code', ''), '');
    end if;

  elsif tg_op = 'UPDATE' then
    if not (old.status is distinct from new.status and new.status = 'CLOSED') then
      return new;
    end if;
    if (v_meta->>'received_now')::boolean is true then
      return new; -- já saiu como "pago na hora" na criação
    end if;
    select p.payment_method, p.gateway_type, p.payment_type
      into v_pay
      from client_portal_payments p
     where p.client_id = new.client_id
       and new.id = any(coalesce(p.settled_alert_ids, '{}'::uuid[]))
     order by p.created_at desc
     limit 1;
    if found then
      v_type := 'PENDING_SETTLED';
      v_msg := 'Pendência quitada · ' || new.message || coalesce(' · ' || v_money, '')
               || case when v_pay.payment_method = 'manual' then ' · baixa manual'
                       else ' · pago pelo portal' end;
    else
      v_type := 'PENDING_DISMISSED';
      v_msg := 'Pendência encerrada sem pagamento registrado · ' || new.message || coalesce(' · ' || v_money, '');
    end if;
  else
    return new;
  end if;

  if exists (select 1 from client_events e
              where e.client_id = new.client_id
                and e.event_type = v_type
                and e.meta->>'alert_id' = new.id::text) then
    return new;
  end if;

  insert into client_events (tenant_id, client_id, event_type, message, meta)
  values (new.tenant_id, new.client_id, v_type, v_msg,
          v_meta || jsonb_build_object('alert_id', new.id, 'kind', v_kind, 'amount', new.amount, 'currency', new.currency));
  return new;
exception when others then
  -- Evento é só exibição: nunca pode derrubar a criação/quitação do sino.
  raise warning 'log_client_alert_timeline_event: %', sqlerrm;
  return new;
end $$;

revoke all on function public.log_client_alert_timeline_event() from public, anon, authenticated;

drop trigger if exists trg_client_alerts_timeline on public.client_alerts;
create trigger trg_client_alerts_timeline
after insert or update of status on public.client_alerts
for each row execute function public.log_client_alert_timeline_event();
