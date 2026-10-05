-- docs/sql/cleanup_cron_history.sql
-- ✅ 05/10/2026, pedido do Márcio (plano gratuito do Supabase, 500 MB):
-- cron.job_run_details (histórico de execuções do pg_cron) nunca era limpo —
-- 99 mil linhas / 18 MB (36% do banco) desde jan/2026, ~3.300 linhas por dia.
-- Mantém só os últimos 7 dias; roda todo dia às 08:45 (UTC).
create or replace function public.cleanup_cron_history()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.cleanup_cron_history() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'cleanup_cron_history_daily';
select cron.schedule('cleanup_cron_history_daily', '45 8 * * *', $$select public.cleanup_cron_history();$$);
