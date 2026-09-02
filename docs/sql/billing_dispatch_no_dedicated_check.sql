-- ✅ 02/09/2026, pedido do Márcio: em vez do billing_dispatch_check disparar
-- uma checagem DEDICADA de status quando o cache de conectividade
-- (system_health_checks) está velho, a própria tentativa de envio real
-- (lib/whatsapp/disconnect-alert.ts, reportWhatsAppDisconnected/
-- Reconnected — agora atualiza esse mesmo cache) já cumpre esse papel.
-- Fluxo final: cache fresco + confirmado down -> pula. Cache fresco + ok
-- (ou incerto/velho, fail-open) -> chama envio_programado normalmente,
-- que tenta enviar de verdade e essa tentativa RENOVA os 10min do cache
-- pro próximo tick, sem nenhuma chamada extra à VM só pra checar status.
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
  -- 1) tem job pronto pra disparar agora?
  select array_agg(distinct case when whatsapp_session = 'session2' then 'whatsapp_2' else 'whatsapp_1' end)
  into v_needed_sessions
  from client_message_jobs
  where status in ('QUEUED','SCHEDULED')
    and send_at <= now();

  if v_needed_sessions is null then
    return;
  end if;

  -- 2) confirmado down (cache fresco, <10min) pra TODAS as sessões
  -- necessárias? fail-open: sem dado fresco não conta como confirmado.
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
    return;
  end if;

  -- 3) chama o envio — a própria tentativa (sucesso ou falha confirmada)
  -- atualiza o cache pro próximo tick.
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
