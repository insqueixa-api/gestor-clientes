-- ✅ 08/10/2026: preenche a Linha do Tempo pros sinos renewal_trust /
-- app_activation que já existiam antes do gatilho
-- (docs/sql/client_alerts_timeline_events.sql). Mesmas regras do gatilho,
-- nas datas originais (criação = created_at do sino; quitação = closed_at).
-- Só eventos (exibição). Idempotente: pula o que já tem meta.alert_id.

with a as (
  select al.*,
         case when al.amount is null then null
              else case coalesce(al.currency, 'BRL') when 'BRL' then 'R$ ' when 'EUR' then '€ ' when 'USD' then 'US$ '
                        else al.currency || ' ' end
                   || replace(to_char(al.amount, 'FM9999990.00'), '.', ',') end as money,
         coalesce((al.meta->>'received_now')::boolean, false) as received_now
    from client_alerts al
   where al.kind in ('renewal_trust', 'app_activation') and al.client_id is not null
),
creation as (
  select a.tenant_id, a.client_id, a.created_at,
         case a.kind when 'renewal_trust' then 'TRUST_RENEWAL' else 'APP_ACTIVATION' end as event_type,
         a.message || coalesce(' · ' || a.money, '')
           || case when a.kind = 'app_activation' and a.received_now then ' · pago na hora' else ' · aguardando pagamento' end
           || case when a.kind = 'app_activation' then coalesce(' · cupom ' || nullif(a.meta->>'coupon_code', ''), '') else '' end as message,
         coalesce(a.meta, '{}'::jsonb) || jsonb_build_object('alert_id', a.id, 'kind', a.kind, 'amount', a.amount, 'currency', a.currency) as meta
    from a
   where not (a.kind = 'renewal_trust' and exists (
           -- renew_client_trust já gravou o RENEWAL dela no mesmo instante
           select 1 from client_events e where e.client_id = a.client_id and e.created_at = a.created_at))
),
closing as (
  select a.tenant_id, a.client_id, coalesce(a.closed_at, a.created_at) as created_at,
         case when p.id is not null then 'PENDING_SETTLED' else 'PENDING_DISMISSED' end as event_type,
         case when p.id is not null
              then 'Pendência quitada · ' || a.message || coalesce(' · ' || a.money, '')
                   || case when p.payment_method = 'manual' then ' · baixa manual' else ' · pago pelo portal' end
              else 'Pendência encerrada sem pagamento registrado · ' || a.message || coalesce(' · ' || a.money, '') end as message,
         coalesce(a.meta, '{}'::jsonb) || jsonb_build_object('alert_id', a.id, 'kind', a.kind, 'amount', a.amount, 'currency', a.currency) as meta
    from a
    left join lateral (
      select p.id, p.payment_method from client_portal_payments p
       where p.client_id = a.client_id and a.id = any(coalesce(p.settled_alert_ids, '{}'::uuid[]))
       order by p.created_at desc limit 1
    ) p on true
   where a.status = 'CLOSED' and not a.received_now
),
todos as (select * from creation union all select * from closing)
insert into client_events (tenant_id, client_id, created_at, event_type, message, meta)
select t.tenant_id, t.client_id, t.created_at, t.event_type, t.message, t.meta
  from todos t
 where not exists (select 1 from client_events e
                    where e.client_id = t.client_id and e.event_type = t.event_type
                      and e.meta->>'alert_id' = t.meta->>'alert_id')
returning event_type, created_at, left(message, 110) as message;
