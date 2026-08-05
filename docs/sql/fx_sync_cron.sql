-- Cron do câmbio (app/api/fx/sync) — pedido do Márcio, 05/08/2026: tirar o
-- refresh de tenant_fx_rates de dentro do login (rodava a cada login,
-- mesmo sendo idempotente por dia) e passar pro mesmo mecanismo já usado
-- pelos outros crons do projeto (EPG sync, snapshot financeiro etc.):
-- pg_cron + pg_net chamando a rota via HTTP, com o token guardado no
-- Supabase Vault (não hardcoded no texto do cron.job.command — ver o
-- incidente documentado em docs/sql/epg_cron_secret_vault.sql).
--
-- Pré-requisito: já ter colocado o MESMO valor do secret abaixo na env var
-- FX_SYNC_CRON_SECRET da Vercel (Production) — é o que a rota
-- app/api/fx/sync/route.ts usa pra validar a chamada. Sem isso, a rota
-- responde 401 pro pg_cron pra sempre.

-- 1) Guarda o secret no Vault (troque o valor abaixo pelo MESMO que você
--    colocou na Vercel, se for diferente do gerado nesta conversa).
select vault.create_secret(
  '22ff014c93cffb4af4bfbb0d4864d9c3a9140a3e7e33b553f42b6b48406d2e00',
  'fx_sync_cron_secret',
  'Bearer token do cron de câmbio (app/api/fx/sync). Ver docs/sql/epg_cron_secret_vault.sql pra instruções de rotação.'
);

-- 2) Agenda o job — 05:00 UTC = 02:00 em São Paulo (cron.timezone do
--    projeto é GMT/UTC, confirmado via `show cron.timezone`). Roda antes
--    dos jobs de EPG (que começam às 05:30 UTC), sem disputar recurso.
select cron.schedule(
  'fx_sync_daily',
  '0 5 * * *',
  $$
  select net.http_post(
    url     := 'https://unigestor.net.br/api/fx/sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'fx_sync_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Conferir depois de rodar (sem esperar até de madrugada — dá pra testar
-- na hora, o job aceita disparo manual):
--   select cron.schedule('fx_sync_manual_test', '* * * * *', $$ select net.http_post(...) $$); -- roda a cada minuto, ideal só pra 1 teste e depois: select cron.unschedule('fx_sync_manual_test');
-- Ou simplesmente: select net.http_post(url := '...', headers := ...); direto no SQL editor, uma vez, pra ver a resposta.
--
-- Ver execuções: select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'fx_sync_daily') order by start_time desc limit 5;
-- Ver resposta HTTP real (net.http_post só falha se o ENQUEUE falhar, não
-- se a resposta for 401/500 — status real fica em net._http_response):
--   select * from net._http_response order by created desc limit 5;
