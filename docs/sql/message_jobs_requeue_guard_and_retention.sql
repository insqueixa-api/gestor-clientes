-- Incidente 29/08/2026: 2 clientes receberam mensagem duplicada — causa
-- raiz achada e confirmada (ver conversa): o botão "Reenviar" do modal de
-- Logs (app/admin/gerenciador/cobranca/LogsModal.tsx) inseria job novo
-- direto do navegador, sem NENHUMA checagem de duplicata — diferente do
-- enfileiramento automático diário (billing_enqueue_scheduled), que já tem
-- essa trava. Bastava selecionar 2 falhas do MESMO cliente (aconteceu de
-- verdade — "Ana Cristina" aparece 2x no log) e clicar reenviar pra criar 2
-- jobs de verdade, cada um enviado independente.
--
-- 1) RPC nova — toda a lógica de reenfileirar migra pro banco, com a MESMA
--    trava de "já tem outro envio deste template hoje" usada no automático.
--    Cobre o caso de selecionar 2+ falhas do mesmo cliente de uma vez: cada
--    iteração do loop enxerga o que a iteração anterior já inseriu (mesma
--    transação), então só a primeira de fato reenvia — a segunda é
--    cancelada com o motivo explicado, nunca duplica o envio de verdade.
create or replace function public.requeue_message_jobs(p_tenant_id uuid, p_ids uuid[])
returns table(job_id uuid, action text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
  v_today date := (timezone('America/Sao_Paulo', v_now))::date;
  r record;
  v_current_send_at timestamptz := v_now;
  v_delay int;
  v_dup_exists boolean;
  v_new_id uuid;
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  for r in
    select j.id, j.client_id, j.reseller_id, j.message, j.image_url, j.message_template_id,
           j.whatsapp_session, j.automation_id
    from public.client_message_jobs j
    where j.tenant_id = p_tenant_id and j.id = any(p_ids)
    order by j.send_at asc
  loop
    v_dup_exists := exists (
      select 1
      from public.client_message_jobs j2
      where j2.tenant_id = p_tenant_id
        and j2.client_id = r.client_id
        and j2.message_template_id = r.message_template_id
        and j2.id <> r.id
        and (timezone('America/Sao_Paulo', j2.send_at))::date = v_today
        and j2.status in ('SCHEDULED', 'QUEUED', 'SENDING', 'SENT')
    );

    if v_dup_exists then
      update public.client_message_jobs
      set status = 'CANCELLED',
          error_message = 'Não reenviado — cliente já tem outro envio deste template hoje.'
      where id = r.id;

      job_id := r.id;
      action := 'skipped_duplicate';
      return next;
    else
      -- Escadinha (10-30s por item) — mesma janela já usada no reenfileiro
      -- manual antigo (client-side), só que agora server-side.
      v_delay := 10 + floor(random() * 20);
      v_current_send_at := v_current_send_at + make_interval(secs => v_delay);

      insert into public.client_message_jobs (
        tenant_id, message, image_url, message_template_id, automation_id,
        whatsapp_session, status, send_at, client_id, reseller_id
      ) values (
        p_tenant_id, r.message, r.image_url, r.message_template_id, r.automation_id,
        coalesce(r.whatsapp_session, 'default'), 'SCHEDULED', v_current_send_at,
        case when r.reseller_id is null then r.client_id else null end,
        r.reseller_id
      )
      returning id into v_new_id;

      update public.client_message_jobs
      set status = 'CANCELLED', error_message = 'Reenfileirado manualmente via Logs'
      where id = r.id;

      job_id := v_new_id;
      action := 'requeued';
      return next;
    end if;
  end loop;
end;
$function$;

revoke all on function public.requeue_message_jobs(uuid, uuid[]) from public;
grant execute on function public.requeue_message_jobs(uuid, uuid[]) to authenticated;

-- 2) Retenção — pedido do Márcio, 29/08/2026: registro de envio não precisa
--    viver pra sempre (achou linha de 24/02/2026 ainda lá) — se falhou, é
--    tratado no mesmo dia; depois de 7 dias não serve mais pra nada.
--    Apaga por idade, sem filtrar status — SENDING não fica pendurado por
--    dias na prática (é revivido pra QUEUED depois de 5min se travar, ver
--    app/api/whatsapp/envio_programado/route.ts), então não precisa de
--    carve-out especial pra ele.
create or replace function public.cleanup_old_message_jobs()
returns void
language sql
security definer
as $function$
  delete from public.client_message_jobs
  where send_at < now() - interval '7 days';
$function$;

select cron.schedule(
  'cleanup_old_message_jobs_daily',
  '55 8 * * *',
  $$ select public.cleanup_old_message_jobs(); $$
);

-- Conferir depois de rodar:
--   select * from cron.job where jobname in ('cleanup_old_message_jobs_daily');
--   select count(*) from client_message_jobs where send_at < now() - interval '7 days' and status in ('SENT','FAILED','CANCELLED');
