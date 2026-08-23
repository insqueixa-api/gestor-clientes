-- Cron de expurgo dos PDFs de Edições publicadas (app/api/admin/condominio/
-- purge-pdfs) — pedido do Márcio, 23/08/2026: PDF fica salvo no R2 só a
-- partir da publicação (não em pré-visualização), e some do storage 6
-- meses depois de publicado (a linha da edição continua existindo, só o
-- arquivo/pdf_url são removidos). Mesmo mecanismo dos outros crons do
-- projeto: pg_cron + pg_net chamando a rota via HTTP, token no Supabase
-- Vault (NÃO hardcoded no cron.job.command — ver incidente documentado em
-- docs/sql/epg_cron_secret_vault.sql).
--
-- ⚠️ NÃO cole o token real neste arquivo — só o placeholder <token> abaixo,
-- exatamente como nos outros crons.

-- Pré-requisito: colocar o MESMO valor do secret abaixo na env var
-- PDF_PURGE_CRON_SECRET da Vercel (Production) — é o que a rota usa pra
-- validar a chamada. Sem isso, a rota responde 401 pro pg_cron pra sempre.

-- 1) Guarda o secret no Vault (só roda limpo na primeira vez — pra
--    rotacionar depois, usar vault.update_secret em vez de create_secret,
--    igual documentado em fx_sync_cron.sql):
select vault.create_secret(
  '<token>',
  'pdf_purge_cron_secret',
  'Bearer token do cron de expurgo de PDFs de condomínio (app/api/admin/condominio/purge-pdfs). Ver docs/sql/epg_cron_secret_vault.sql pra instruções de rotação.'
);

-- 2) Agenda o job — diário, 08:30 UTC = 05:30 em São Paulo (mesma janela de
--    madrugada dos outros crons de manutenção). É um job leve (poucas
--    linhas por dia, na prática), não precisa rodar mais de 1x/dia.
select cron.schedule(
  'condominio_pdf_purge_daily',
  '30 8 * * *',
  $$
  select net.http_post(
    url     := 'https://unigestor.net.br/api/admin/condominio/purge-pdfs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'pdf_purge_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Conferir depois de rodar (dá pra testar na hora, sem esperar a madrugada):
--   select net.http_post(url := 'https://unigestor.net.br/api/admin/condominio/purge-pdfs', headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'pdf_purge_cron_secret'), 'Content-Type', 'application/json'), body := '{}'::jsonb);
--   select * from net._http_response order by created desc limit 5;
-- Ver execuções do job agendado:
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'condominio_pdf_purge_daily') order by start_time desc limit 5;
