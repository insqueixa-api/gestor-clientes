-- 30/08/2026: RPC pro botão "Crons" no sino (histórico de crons) — dá pro
-- Márcio conferir se tudo que roda de madrugada disparou certo, sem entrar
-- no Supabase. Lê cron.job/cron.job_run_details (schema não exposto via
-- PostgREST), por isso precisa de SECURITY DEFINER — só devolve
-- jobname/schedule/active/status, nunca a coluna `command` (pode ter texto
-- sensível de jobs antigos que ainda não migraram pro Vault).
--
-- is_http_trigger: quando o command chama net.http_post(), o status do
-- pg_cron só confirma que o DISPARO foi enfileirado, não que a rota HTTP
-- terminou bem (mesmo gotcha já documentado em lib/cron-health.ts) — a UI
-- avisa isso e mostra a tabela de cron_health ao lado como sinal completo.
CREATE OR REPLACE FUNCTION public.admin_list_pgcron_status()
 RETURNS TABLE(
   jobname text,
   schedule text,
   active boolean,
   is_http_trigger boolean,
   last_run_at timestamptz,
   last_run_status text,
   last_success_at timestamptz
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    j.jobname,
    j.schedule,
    j.active,
    (j.command ilike '%net.http_post%') as is_http_trigger,
    lr.start_time as last_run_at,
    lr.status as last_run_status,
    ls.last_success as last_success_at
  from cron.job j
  left join lateral (
    select start_time, status
    from cron.job_run_details
    where jobid = j.jobid
    order by start_time desc
    limit 1
  ) lr on true
  left join lateral (
    select max(start_time) as last_success
    from cron.job_run_details
    where jobid = j.jobid and status = 'succeeded'
  ) ls on true
  order by j.jobname;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_pgcron_status() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_pgcron_status() TO service_role;

-- Conferir depois de rodar:
--   select * from admin_list_pgcron_status();
