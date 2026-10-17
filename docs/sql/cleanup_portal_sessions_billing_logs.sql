-- ✅ 17/10/2026, pedido do Márcio: limpeza diária do que acumulava sem uso.
--   * client_portal_sessions: sessão do portal vale 30 min — apaga as que
--     expiraram há mais de 1 dia (folga pra sessão em uso nunca ser tocada).
--   * billing_logs: log de envio da cobrança, guardado 7 dias (mesma regra
--     da fila client_message_jobs). Só é gravado (billing_mark_sent/failed,
--     envio_programado) — nenhuma tela lê.
create or replace function public.cleanup_portal_sessions_and_billing_logs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions integer;
  v_logs integer;
begin
  delete from public.client_portal_sessions
   where expires_at < now() - interval '1 day';
  get diagnostics v_sessions = row_count;

  delete from public.billing_logs
   where sent_at < now() - interval '7 days';
  get diagnostics v_logs = row_count;

  return jsonb_build_object('sessions', v_sessions, 'billing_logs', v_logs);
end $$;

revoke all on function public.cleanup_portal_sessions_and_billing_logs() from public, anon, authenticated;

select cron.unschedule('cleanup_portal_sessions_billing_logs_daily')
 where exists (select 1 from cron.job where jobname = 'cleanup_portal_sessions_billing_logs_daily');
select cron.schedule('cleanup_portal_sessions_billing_logs_daily', '58 8 * * *',
  'select public.cleanup_portal_sessions_and_billing_logs();');

-- primeira limpeza agora
select public.cleanup_portal_sessions_and_billing_logs();
