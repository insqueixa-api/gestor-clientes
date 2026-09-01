-- ✅ 01/09/2026 — achado do Márcio: notificação "automacao_falha" (sino) só
-- se resolve via ação explícita no modal de Logs da cobrança (Reenviar/
-- Marcar recebido, ver LogsModal.tsx:resolveIfNoMoreFailures). Se o job
-- FAILED que a originou sumir por qualquer outro caminho (reenviado por
-- outra tela, limpo, etc.), a notificação nunca sabe e fica aberta pra
-- sempre — achado real: 1 notificação de 3 dias atrás sem nenhum FAILED
-- correspondente, o admin não conseguia achar a falha no log da própria
-- automação porque ela já não existia mais.
--
-- Estende cleanup_old_message_jobs() (já roda 1x/dia via pg_cron,
-- cleanup_old_message_jobs_daily) pra também reconciliar: resolve qualquer
-- automacao_falha aberta sem nenhum FAILED de verdade pendente.
CREATE OR REPLACE FUNCTION public.cleanup_old_message_jobs()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  delete from public.client_message_jobs
  where send_at < now() - interval '7 days';

  update public.notifications n
  set resolved_at = now()
  where n.type = 'automacao_falha'
    and n.resolved_at is null
    and not exists (
      select 1 from public.client_message_jobs j
      where j.automation_id = n.source_id::uuid
        and j.status = 'FAILED'
    );
end;
$function$;
