-- ✅ 01/09/2026 — billing_dispatch_check() batia na rota /envio_programado a
-- cada 2 min mesmo com o WhatsApp desconectado (não ia enviar nada mesmo
-- assim), gastando invocação da Vercel à toa. Agora checa o status já
-- cacheado em system_health_checks (atualizado a cada 5min pelo próprio
-- cron do painel Sistema) e só bate na rota se pelo menos UMA das sessões
-- que os jobs pendentes precisam estiver com status 'ok' fresco (< 10min).
-- Fail-open: se o dado estiver ausente/velho pra alguma sessão necessária,
-- trata como "não confirmado down" e deixa a rota rodar normalmente — nunca
-- trava o envio real por causa de um problema no check de saúde em si.
CREATE OR REPLACE FUNCTION public.billing_dispatch_check()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_secret text;
  v_needed_sessions text[];
  v_all_confirmed_down boolean;
begin
  select array_agg(distinct case when whatsapp_session = 'session2' then 'whatsapp_2' else 'whatsapp_1' end)
  into v_needed_sessions
  from client_message_jobs
  where status in ('QUEUED','SCHEDULED')
    and send_at <= now();

  if v_needed_sessions is null then
    return;
  end if;

  select bool_and(
    exists (
      select 1 from system_health_checks h
      where h.check_key = s
        and h.checked_at > now() - interval '10 minutes'
        and h.status <> 'ok'
    )
  )
  into v_all_confirmed_down
  from unnest(v_needed_sessions) as s;

  if v_all_confirmed_down then
    raise notice '[billing_dispatch_check] pulado — WhatsApp confirmadamente desconectado (sessões: %)', v_needed_sessions;
    return;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'billing_cron_secret';

  if v_secret is null then
    raise warning '[billing_dispatch_check] billing_cron_secret ausente no Vault';
    return;
  end if;

  perform net.http_post(
    url := 'https://unigestor.net.br/api/whatsapp/envio_programado',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$function$;
