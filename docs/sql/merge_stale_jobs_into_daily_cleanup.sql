-- ✅ 01/09/2026, pedido do Márcio: em vez de um cron separado só pra
-- cancelar mensagens pendentes de um dia anterior (cancel_stale_pending_
-- jobs_daily, jobid 56, criado mais cedo hoje), junta essa lógica dentro
-- do cron de limpeza diária que já existe (cleanup_old_message_jobs_daily,
-- 5:55 SP) — que já tinha ganhado hoje mais cedo a reconciliação de
-- notificação de automação órfã. Um cron só fazendo as 3 coisas.

-- remove o cron separado criado mais cedo
select cron.unschedule('cancel_stale_pending_jobs_daily');
drop function if exists public.cancel_stale_pending_message_jobs();

CREATE OR REPLACE FUNCTION public.cleanup_old_message_jobs()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  -- 1) apaga jobs com mais de 7 dias (histórico antigo)
  delete from public.client_message_jobs
  where send_at < now() - interval '7 days';

  -- 2) cancela mensagens que ficaram pendentes de um dia anterior (não
  -- pode atravessar a virada do dia esperando o próximo tick do cron de
  -- despacho pegar num dia errado — ex: WhatsApp caiu o dia inteiro).
  update public.client_message_jobs
  set status = 'CANCELLED',
      error_message = 'Cancelado automaticamente — ficou pendente de um dia anterior'
  where status in ('QUEUED', 'SCHEDULED', 'SENDING')
    and (timezone('America/Sao_Paulo', send_at))::date < (timezone('America/Sao_Paulo', now()))::date;

  -- 3) reconcilia notificação de "automação falhou" (sino) que ficou
  -- aberta sem nenhum FAILED de verdade pendente (achado: notificação de
  -- 3 dias atrás presa pra sempre porque o job que a originou já não
  -- existia mais).
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
