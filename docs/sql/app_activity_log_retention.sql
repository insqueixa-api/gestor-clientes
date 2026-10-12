-- ✅ 12/10/2026, pedido do Márcio ("não tem o porquê ter mais"): o
-- histórico de aplicativos (client_app_activity_log) guarda só os 50
-- registros mais recentes de cada app. Antes não tinha limpeza nenhuma
-- (crescia pra sempre — 768 linhas desde 25/07/2026).
--
-- Nunca apaga registro com menos de 1 dia: os limites de tentativas do
-- portal (configure/check-validity/add) contam os eventos dos últimos
-- minutos nessa mesma tabela.
-- Quem lê: página Aplicativo ID (mostra 50), Auditoria → Aplicativos (200
-- mais recentes no geral) e os limites de tentativas acima.

create or replace function public.cleanup_app_activity_log()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  with ranked as (
    select id, created_at,
           row_number() over (partition by tenant_id, lower(app_name) order by created_at desc) as rn
      from client_app_activity_log
  )
  delete from client_app_activity_log l
   using ranked r
   where l.id = r.id
     and r.rn > 50
     and r.created_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_app_activity_log() from public, anon, authenticated;

-- todo dia, junto das outras limpezas (08:xx UTC)
select cron.unschedule('cleanup_app_activity_log_daily')
 where exists (select 1 from cron.job where jobname = 'cleanup_app_activity_log_daily');
select cron.schedule('cleanup_app_activity_log_daily', '50 8 * * *', $$ select public.cleanup_app_activity_log(); $$);
