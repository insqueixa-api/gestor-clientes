-- Cron do câmbio (app/api/fx/sync) — pedido do Márcio, 05/08/2026: tirar o
-- refresh de tenant_fx_rates de dentro do login (rodava a cada login,
-- mesmo sendo idempotente por dia) e passar pro mesmo mecanismo já usado
-- pelos outros crons do projeto (EPG sync, snapshot financeiro etc.):
-- pg_cron + pg_net chamando a rota via HTTP, com o token guardado no
-- Supabase Vault (não hardcoded no texto do cron.job.command — ver o
-- incidente documentado em docs/sql/epg_cron_secret_vault.sql).
--
-- ⚠️ INCIDENTE 05/08/2026: a primeira versão deste arquivo tinha o valor
-- REAL do token no lugar de <token> abaixo — foi commitado e pushado pro
-- GitHub em texto puro. Rotacionado assim que percebido (vault.update_secret
-- + novo valor na Vercel + .env.local). Mesmo padrão de vazamento já
-- documentado em docs/sql/epg_cron_secret_vault.sql — dali em diante,
-- comandos históricos de create_secret usam <token> como placeholder, nunca
-- o valor de verdade. NÃO cole o token real neste arquivo.

-- Pré-requisito: já ter colocado o MESMO valor do secret abaixo na env var
-- FX_SYNC_CRON_SECRET da Vercel (Production) — é o que a rota
-- app/api/fx/sync/route.ts usa pra validar a chamada. Sem isso, a rota
-- responde 401 pro pg_cron pra sempre.

-- 1) Guarda o secret no Vault — SÓ roda limpo na primeira vez (create_secret
--    dá erro de constraint única se o name já existir). Pra rotacionar
--    depois (como aconteceu aqui), use vault.update_secret, não isso:
--      select vault.update_secret(
--        (select id from vault.decrypted_secrets where name = 'fx_sync_cron_secret'),
--        '<novo_token_aqui>'
--      );
--    Não precisa mexer em cron.job nenhum depois de rotacionar — o job lê o
--    valor atual do Vault a cada execução, via subquery.
select vault.create_secret(
  '<token>',
  'fx_sync_cron_secret',
  'Bearer token do cron de câmbio (app/api/fx/sync). Ver docs/sql/epg_cron_secret_vault.sql pra instruções de rotação.'
);

-- 2) Agenda o job — 08:50 UTC = 05:50 em São Paulo (cron.timezone do
--    projeto é GMT/UTC, confirmado via `show cron.timezone`). Reagendado de
--    02:00 pra 05:50 a pedido do Márcio, 05/08/2026: fecha a janela de
--    crons no FIM da madrugada (10min depois do último, force_eternal_
--    tokens_daily às 05:40 BRT), deixando o INÍCIO da madrugada (00h-02h)
--    livre pra outras coisas futuras. Testado em produção após esse ajuste:
--    net.http_post retornou 200 com {"ok":true,"results":[{"skipped":true,
--    "reason":"já tem taxa de hoje"}]} — confirma que a rota e a
--    idempotência diária estão funcionando ponta a ponta.
select cron.schedule(
  'fx_sync_daily',
  '50 8 * * *',
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
