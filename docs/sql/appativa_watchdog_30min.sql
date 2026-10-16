-- ✅ 16/10/2026, pedido do Márcio: vigia de pagamento da Appativa confere só
-- nos primeiros 30 min (era 3h), de 2 em 2 min. Depois disso, "Ver status"
-- manual na Auditoria. Mesma janela em
-- app/api/cron/appativa-payment-watchdog/route.ts.
create or replace function public.appativa_payment_dispatch_check()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_secret text;
  v_tem_pendencia boolean;
begin
  select exists (
    select 1
    from client_portal_payments p
    where p.fulfillment_status = 'manual_pending'
      and p.appativa_historico_id is not null
      and p.fulfillment_error is null
      and p.created_at >= now() - interval '30 minutes'
  ) into v_tem_pendencia;

  if not v_tem_pendencia then
    return;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'appativa_watchdog_cron_secret';

  if v_secret is null then
    raise warning '[appativa_payment_dispatch_check] appativa_watchdog_cron_secret ausente no Vault';
    return;
  end if;

  perform net.http_post(
    url := 'https://unigestor.net.br/api/cron/appativa-payment-watchdog',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$function$;
