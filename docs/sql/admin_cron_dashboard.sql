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

-- ============================================================
-- 30/08/2026: wrapper que devolve pg_cron + cron_health numa ÚNICA chamada
-- (pedido do Márcio, achado via Speed Insights: a rota fazia 1 chamada por
-- job em série antes disso — corrigido pra 2 em paralelo, e agora pra 1 só).
-- O mapeamento de nomes/rótulos/grupos continua só no TypeScript
-- (app/api/cron/status/route.ts) de propósito — é a mesma "fonte única" do
-- vigia diário (lib/cron-health.ts); duplicar em SQL criaria 2 lugares pra
-- manter sincronizados a cada cron novo.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_cron_dashboard_raw()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'pgcron', coalesce((select jsonb_agg(p) from admin_list_pgcron_status() p), '[]'::jsonb),
    'health', coalesce((
      select jsonb_agg(jsonb_build_object(
        'job_name', job_name,
        'last_ok_at', last_ok_at,
        'last_error', last_error,
        'last_error_at', last_error_at
      ))
      from cron_health
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_cron_dashboard_raw() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_cron_dashboard_raw() TO service_role;

-- Conferir depois de rodar:
--   select admin_cron_dashboard_raw();
