-- docs/sql/recover_stuck_payments_cron.sql
--
-- Rede de segurança pro cenário documentado em isStuckFulfillment (app/
-- admin/auditoria/page.tsx) e no incidente de 15/08/2026 (licença de app do
-- Adenilson travada sem notificar ninguém): o fulfillment de um pagamento
-- aprovado só roda via webhook do gateway OU polling do navegador do
-- cliente — se os dois falharem, nada reprocessa sozinho. Existia um botão
-- "Reprocessar" manual pra isso desde 24/07/2026, mas nada disparava ele
-- sozinho — só notificava o admin se ele abrisse a Auditoria por acaso e
-- reparasse no badge "Travada". Este cron chama app/api/admin/payments/
-- recover-stuck/route.ts a cada 5 minutos — encontra qualquer pagamento
-- aprovado preso a mais de 10min (mesmo limiar da badge "Travada") e
-- reprocessa sozinho.
--
-- ⚠️ Mesmo padrão de segurança de docs/sql/fx_sync_cron.sql: o valor real
-- do secret NUNCA vai neste arquivo (incidente de vazamento já documentado
-- em docs/sql/epg_cron_secret_vault.sql) — <token> é só placeholder. O
-- Márcio precisa colocar o MESMO valor na env var
-- RECOVER_STUCK_PAYMENTS_CRON_SECRET da Vercel (Production) — sem isso a
-- rota responde 401 pro pg_cron pra sempre.

select vault.create_secret(
  '<token>',
  'recover_stuck_payments_cron_secret',
  'Bearer token do cron de recuperação de pagamentos travados (app/api/admin/payments/recover-stuck). Ver docs/sql/epg_cron_secret_vault.sql pra instruções de rotação.'
);

select cron.schedule(
  'recover_stuck_payments',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://unigestor.net.br/api/admin/payments/recover-stuck',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'recover_stuck_payments_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Ver execuções: select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'recover_stuck_payments') order by start_time desc limit 5;
-- Ver resposta HTTP real (net.http_post só falha se o ENQUEUE falhar, não
-- se a resposta for 401/500 — status real fica em net._http_response):
--   select * from net._http_response order by created desc limit 5;
