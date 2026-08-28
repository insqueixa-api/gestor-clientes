-- Vigia unificado de crons — pedido do Márcio, 28/08/2026.
--
-- Contexto: o incidente do sync-jogos (26/08) mostrou que um cron pode
-- morrer em silêncio (Vercel mata a função por timeout, sem gerar exceção
-- nenhuma — net.http_post só garante o ENQUEUE, não a conclusão real). A
-- correção imediata foi Sentry Cron Monitoring em 3 rotas, mas o plano
-- grátis do Sentry só libera 1 monitor por org — 2 dos 3 ficaram "disabled"
-- sem nunca ter rodado de verdade. Levantamento (28/08) achou 20 jobs
-- ativos no pg_cron + 1 disparado via crontab da VM Hetzner (sync-catalog-
-- fast) — só 1 tinha alguma forma de detecção de falha silenciosa.
--
-- Desenho: em vez de brigar pela cota de Cron Monitors, um watchdog próprio
-- (app/api/cron/watchdog/route.ts) decide se algum job está "velho demais".
-- Roda 1x por dia (09:20 UTC — ~30min depois do último job da janela de
-- madrugada, fx-sync às 08:50) em vez de ficar checando o dia inteiro:
-- pedido do Márcio, 28/08/2026, já que todos os crons rodam só de manhã
-- cedo. Se algum job estiver velho demais, dispara 1 ÚNICO
-- Sentry.captureMessage (cota de Errors — 5.000/mês, sobra) listando TODOS
-- os que falharam naquele dia — fingerprint fixo, não muda com a lista, então
-- vira sempre o MESMO issue em vez de um novo por job. Quando a lista volta
-- a ficar vazia (todo mundo rodou OK de novo), o próximo check resolve esse
-- issue sozinho — ou dá pra resolver na mão direto no Sentry a qualquer
-- momento, sem esperar o check do dia seguinte.
--
-- Dois tipos de job:
--   - "sql": função PLPGSQL chamada direto pelo pg_cron (auto_archive_*,
--     vacuum_*, etc.) — cron.job_run_details já registra sucesso/falha de
--     verdade (não passa por net.http_post), então dá pra ler de lá direto
--     via get_cron_last_success(), sem heartbeat nenhum.
--   - "http": job cujo trabalho de verdade roda numa rota Next.js — a rota
--     reporta o próprio heartbeat via reportCronHealth() (lib/cron-
--     health.ts) porque cron.job_run_details só sabe dizer "consegui
--     enfileirar a chamada", não se ela terminou.
--
-- sync-jogos fica de fora (já tem Sentry Cron Monitor de verdade, ativo).

-- 1) Tabela de estado — heartbeat dos jobs "http", mais 1 linha sentinela
--    ('__watchdog_summary__') que guarda só se o alerta-resumo do dia está
--    aberto ou não (evita disparar Sentry de novo todo dia enquanto o
--    mesmo problema persiste).
create table if not exists public.cron_health (
  job_name text primary key,
  last_ok_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  alert_active boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.cron_health enable row level security;
-- Nenhuma policy de propósito — só service_role (que ignora RLS) lê/escreve
-- essa tabela; não é dado de tenant, é operação interna do sistema.

-- 2) RPC read-only pros jobs "sql" — lê o histórico que o próprio pg_cron já
--    mantém (cron.job_run_details), sem precisar de heartbeat manual.
create or replace function public.get_cron_last_success(p_jobname text)
returns timestamptz
language sql
security definer
set search_path = public
as $$
  select max(jrd.start_time)
  from cron.job_run_details jrd
  join cron.job j on j.jobid = jrd.jobid
  where j.jobname = p_jobname
    and jrd.status = 'succeeded';
$$;

revoke all on function public.get_cron_last_success(text) from public;
grant execute on function public.get_cron_last_success(text) to service_role;

-- 3) Seed — evita alerta falso no primeiro tick do vigia antes de qualquer
--    job "http" ter rodado no novo sistema. Jobs "sql" não usam last_ok_at
--    (lido via RPC), só precisam existir pra o upsert de alert_active
--    funcionar sem erro.
insert into public.cron_health (job_name, last_ok_at, alert_active)
values
  ('sync-claro', now(), false),
  ('sync-catalog-elite', now(), false),
  ('sync-catalog-natv', now(), false),
  ('sync-catalog-fast', now(), false),
  ('sync-tmdb', now(), false),
  ('catalogo-limpar', now(), false),
  ('condominio-pdf-purge', now(), false),
  ('fx-sync', now(), false),
  ('fin-snapshot-previsao', now(), false),
  ('auto_archive_expired_clients_daily', null, false),
  ('auto_purge_expired_clients_daily', null, false),
  ('cancel_expired_portal_payments', null, false),
  ('checar-sugestoes-adicionadas', null, false),
  ('check-overdue-transactions', null, false),
  ('cleanup-old-notifications', null, false),
  ('force_eternal_tokens_daily', null, false),
  ('limpeza_diaria_tokens_portal', null, false),
  ('vacuum_catalog_episodes_weekly', null, false),
  ('vacuum_catalog_master_weekly', null, false),
  ('vacuum_catalog_availability_weekly', null, false)
on conflict (job_name) do nothing;

-- 4) Agenda o próprio vigia — 1x por dia, 09:20 UTC (depois do último job
--    esperado da janela de madrugada), reaproveitando o mesmo Vault secret
--    dos outros crons de EPG (mesmo mecanismo isCronRequest, sem precisar
--    criar um secret novo só pra isso). cron.schedule com o mesmo jobname
--    ATUALIZA o job existente — seguro rodar de novo se já tiver criado com
--    '*/30 * * * *' antes.
select cron.schedule(
  'cron_watchdog_check',
  '20 9 * * *',
  $$
  select net.http_post(
    url     := 'https://unigestor.net.br/api/cron/watchdog',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'epg_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Conferir depois de rodar:
--   select * from cron_health order by job_name;
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'cron_watchdog_check') order by start_time desc limit 5;
-- Testar a rota na hora (sem esperar 30min): select net.http_post(url := 'https://unigestor.net.br/api/cron/watchdog', headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'epg_cron_secret'), 'Content-Type', 'application/json'), body := '{}'::jsonb);
