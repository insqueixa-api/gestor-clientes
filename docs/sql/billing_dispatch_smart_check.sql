-- ✅ 01/09/2026 — 2 mudanças pedidas pelo Márcio depois de ver 156
-- invocações da rota /api/cron/system-health-check em 12h (achado: o
-- pg_cron system_health_check_5min criado nesta mesma sessão rodava
-- SOZINHO a cada 5min, 288x/dia, sem ele saber — ele só queria isso sob
-- demanda, quando abre o painel e clica "Sincronizar agora").
--
-- 1) Remove esse cron por completo. O painel Sistema continua funcionando
--    igual (GET /api/system-health lê cache, POST via botão faz o check
--    real) — só não roda mais sozinho em background.
--
-- 2) billing_dispatch_check() (cron de 2 em 2 min) fica mais esperto,
--    3 passos, só avança se o anterior passar:
--    a) tem job de cobrança pronto pra disparar agora? se não, morre aqui
--       (nem olha WhatsApp, nem bate em lugar nenhum).
--    b) WhatsApp das sessões necessárias está conectado? usa cache de
--       10min; se venceu, chama /api/cron/whatsapp-status-check (só as
--       sessões necessárias) e ESPERA a resposta antes de decidir (pg_net
--       síncrono via net.http_collect_response). Se confirmado down pra
--       todas as sessões necessárias, morre aqui.
--    c) só então bate em /api/whatsapp/envio_programado — que já foi
--       alterado (ver git) pra reconferir a elegibilidade de CADA cliente
--       bem antes de mandar a mensagem dele.

select cron.unschedule(55); -- system_health_check_5min

CREATE OR REPLACE FUNCTION public.billing_dispatch_check()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_secret text;
  v_control_secret text;
  v_needed_sessions text[];
  v_stale_sessions text[];
  v_all_confirmed_down boolean;
  v_request_id bigint;
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

  -- 2) cache de 10min do status do WhatsApp — se alguma sessão necessária
  -- estiver sem dado fresco, atualiza agora (síncrono) antes de decidir.
  select array_agg(s) into v_stale_sessions
  from unnest(v_needed_sessions) as s
  where not exists (
    select 1 from system_health_checks h
    where h.check_key = s and h.checked_at > now() - interval '10 minutes'
  );

  if v_stale_sessions is not null then
    begin
      select decrypted_secret into v_control_secret
      from vault.decrypted_secrets
      where name = 'cron_control_secret';

      if v_control_secret is not null then
        select net.http_post(
          url := 'https://unigestor.net.br/api/cron/whatsapp-status-check',
          headers := jsonb_build_object('x-cron-secret', v_control_secret, 'Content-Type', 'application/json'),
          body := jsonb_build_object('sessions', to_jsonb(
            array(select case when s = 'whatsapp_2' then 2 else 1 end from unnest(v_stale_sessions) as s)
          )),
          timeout_milliseconds := 15000
        ) into v_request_id;

        perform net.http_collect_response(v_request_id, async := false);
      end if;
    exception when others then
      raise warning '[billing_dispatch_check] falha ao atualizar cache do WhatsApp: %', sqlerrm;
    end;
  end if;

  -- fail-open: sessão sem dado fresco (check acima falhou ou secret
  -- ausente) NÃO conta como "confirmado down" — só pula quando tem certeza.
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

  -- 3) WhatsApp ok (ou incerto) — chama o envio, que reconfere a
  -- elegibilidade de cada cliente antes de mandar.
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
