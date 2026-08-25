-- Cron de fallback pra ativação automática via Appativa (achado 25/08/2026,
-- em produção, primeira ativação real): o webhook deles
-- (app/api/webhooks/appativa/route.ts) pode demorar muito ou nunca
-- disparar — o próprio /api/historico tem um campo `enviado_n8n` que ficou
-- `false` por vários minutos numa ativação já confirmada do lado deles.
--
-- Esse cron reconsulta a cada 5min os pagamentos travados em manual_pending
-- com appativa_historico_id (app/api/cron/appativa-poll-pending/route.ts),
-- usando a MESMA lógica de conclusão que o webhook usa
-- (resolveAppativaAppRenewal, lib/client-portal/fulfillment.ts) — nunca
-- duplicada entre os dois caminhos.
--
-- Mesmo padrão dos outros crons do projeto: pg_cron + pg_net + Vault (ver
-- docs/sql/epg_cron_secret_vault.sql pra histórico/rotação). NUNCA cole o
-- valor real do token neste arquivo — sempre <token> como placeholder (ver
-- o incidente documentado em docs/sql/fx_sync_cron.sql).
--
-- Pré-requisito: colocar o MESMO valor do secret abaixo na env var
-- APPATIVA_CRON_SECRET da Vercel (Production) e no .env.local — é o que
-- app/api/cron/appativa-poll-pending/route.ts usa pra validar a chamada.

-- 1) Guarda o secret no Vault — só roda limpo na primeira vez. Pra
--    rotacionar depois, use vault.update_secret (não isso de novo):
--      select vault.update_secret(
--        (select id from vault.decrypted_secrets where name = 'appativa_cron_secret'),
--        '<novo_token_aqui>'
--      );
select vault.create_secret(
  '<token>',
  'appativa_cron_secret',
  'Bearer token do cron de fallback da Appativa (app/api/cron/appativa-poll-pending). Ver docs/sql/epg_cron_secret_vault.sql pra instruções de rotação.'
);

-- 2) Agenda o job — a cada 5min. timeout_milliseconds explícito (achado
--    documentado em project_catalog_cleanup_post_sync/memória: o padrão do
--    net.http_post é 5s, curto demais pra uma rota que pode chamar a API da
--    Appativa várias vezes em sequência).
select cron.schedule(
  'appativa_poll_pending',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://unigestor.net.br/api/cron/appativa-poll-pending',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'appativa_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Conferir depois de rodar (sem esperar os 5min — dá pra chamar direto):
--   select net.http_post(url := 'https://unigestor.net.br/api/cron/appativa-poll-pending', headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'appativa_cron_secret')));
-- Ver execuções: select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'appativa_poll_pending') order by start_time desc limit 5;
-- Ver resposta HTTP real (net.http_post só falha se o ENQUEUE falhar, não
-- se a resposta for 401/500 — status real fica em net._http_response):
--   select * from net._http_response order by created desc limit 5;
