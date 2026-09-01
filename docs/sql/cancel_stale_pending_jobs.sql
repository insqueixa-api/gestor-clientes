-- ✅ 01/09/2026, pedido do Márcio: mensagem não pode ficar "pendente" de um
-- dia pro outro (QUEUED/SCHEDULED/SENDING com send_at de um dia anterior
-- ao de hoje, horário de São Paulo) — se não saiu até o fim do dia (ex:
-- WhatsApp caiu o dia inteiro), cancela sozinho de madrugada em vez de
-- ficar pendurada esperando o próximo tick do cron de despacho pegá-la num
-- dia errado.
--
-- Horário escolhido (7:10 UTC = 4:10 SP) fica fora de qualquer outro cron
-- diário já agendado: os syncs pesados (EPG/catálogo/jogos) rodam entre
-- 5:30-6:55 UTC, os de limpeza/token/financeiro entre 7:00-8:55 UTC — "0 7"
-- já é usado por checar-sugestoes-adicionadas, "10 7" está livre.
CREATE OR REPLACE FUNCTION public.cancel_stale_pending_message_jobs()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  update public.client_message_jobs
  set status = 'CANCELLED',
      error_message = 'Cancelado automaticamente — ficou pendente de um dia anterior'
  where status in ('QUEUED', 'SCHEDULED', 'SENDING')
    and (timezone('America/Sao_Paulo', send_at))::date < (timezone('America/Sao_Paulo', now()))::date;
$function$;

select cron.schedule(
  'cancel_stale_pending_jobs_daily',
  '10 7 * * *',
  $$select public.cancel_stale_pending_message_jobs();$$
);
