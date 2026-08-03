-- Continuação de fix_delete_client_forever_missing_fk_cleanup.sql: o mesmo
-- bug (DELETE FROM public.clients sem limpar as 13 tabelas filhas que não
-- têm ON DELETE CASCADE) existia em mais dois lugares.
--
-- 1) auto_purge_expired_clients — CRÍTICO: roda sozinha via pg_cron todo
--    dia às 08:20 (cron.job id 12), apagando definitivamente clientes
--    arquivados há 61+ dias (ou 7+ dias se trial). Como o DELETE cobre
--    todos os clientes elegíveis do dia em uma única instrução, bastava
--    UM cliente do lote ter linha em client_events, client_renewals,
--    coupon_redemptions, google_contacts etc. pra falhar a instrução
--    inteira — e como é cron sem UI, ninguém veria o erro; o cliente
--    simplesmente continuaria acumulado na lixeira sem nenhum aviso.
--    Fix: mesma limpeza de tabelas filhas do delete_client_forever, agora
--    aplicada ao array de ids elegíveis antes do DELETE final.
--
-- 2) delete_server_hard — não é chamado por nenhuma tela hoje (não achei
--    referência em app/), mas é uma RPC exposta que qualquer usuário
--    autenticado do tenant pode chamar. Tinha dois problemas: o mesmo bug
--    de FK (fazia DELETE FROM public.clients where server_id = ... sem
--    limpar as tabelas filhas), e nenhuma trava impedindo apagar clientes
--    que NÃO estão arquivados — ou seja, hard-delete de um servidor
--    arquivado apagaria definitivamente até clientes ativos ainda
--    vinculados a ele. Fix: agora exige que não sobre nenhum cliente não
--    arquivado no servidor (senão levanta exceção pedindo pra arquivar
--    antes) e faz a mesma limpeza de tabelas filhas nos clientes que serão
--    apagados.

-- 1) auto_purge_expired_clients
CREATE OR REPLACE FUNCTION public.auto_purge_expired_clients()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_ids uuid[];
begin
  select array_agg(c.id) into v_ids
  from public.clients c
  where c.is_archived = true
    and c.vencimento is not null
    and (
      (
        coalesce(c.is_trial, false) = false
        and (c.vencimento AT TIME ZONE 'America/Sao_Paulo')::date
              <= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 61
      )
      or
      (
        c.is_trial = true
        and (c.vencimento AT TIME ZONE 'America/Sao_Paulo')::date
              <= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 7
      )
    );

  if v_ids is null or array_length(v_ids, 1) is null then
    return;
  end if;

  if to_regclass('public.client_alerts') is not null then
    delete from public.client_alerts where client_id = any(v_ids);
  end if;

  if to_regclass('public.client_message_jobs') is not null then
    delete from public.client_message_jobs where client_id = any(v_ids);
  end if;

  if to_regclass('public.client_phones') is not null then
    delete from public.client_phones where client_id = any(v_ids);
  end if;

  if to_regclass('public.client_apps') is not null then
    delete from public.client_apps where client_id = any(v_ids);
  end if;

  if to_regclass('public.client_subscriptions') is not null then
    delete from public.client_subscriptions where client_id = any(v_ids);
  end if;

  if to_regclass('public.client_app_activity_log') is not null then
    delete from public.client_app_activity_log where client_id = any(v_ids);
  end if;

  if to_regclass('public.client_app_requests') is not null then
    delete from public.client_app_requests where client_id = any(v_ids);
  end if;

  if to_regclass('public.client_contacts') is not null then
    delete from public.client_contacts where client_id = any(v_ids);
  end if;

  if to_regclass('public.client_events') is not null then
    delete from public.client_events where client_id = any(v_ids);
  end if;

  if to_regclass('public.client_renewals') is not null then
    delete from public.client_renewals where client_id = any(v_ids);
  end if;

  if to_regclass('public.coupon_abuse_guard') is not null then
    delete from public.coupon_abuse_guard where client_id = any(v_ids);
  end if;

  if to_regclass('public.coupon_redemptions') is not null then
    delete from public.coupon_redemptions where client_id = any(v_ids);
  end if;

  if to_regclass('public.epg_config') is not null then
    delete from public.epg_config where client_id = any(v_ids);
  end if;

  if to_regclass('public.fin_previsao_snapshot') is not null then
    delete from public.fin_previsao_snapshot where client_id = any(v_ids);
  end if;

  if to_regclass('public.coupons') is not null then
    update public.coupons set client_id = null where client_id = any(v_ids);
  end if;

  if to_regclass('public.google_contacts') is not null then
    update public.google_contacts set client_id = null where client_id = any(v_ids);
  end if;

  if to_regclass('public.guia_tv_access_log') is not null then
    update public.guia_tv_access_log set client_id = null where client_id = any(v_ids);
  end if;

  if to_regclass('public.server_credit_usage') is not null then
    update public.server_credit_usage set client_id = null where client_id = any(v_ids);
  end if;

  delete from public.clients where id = any(v_ids);
end;
$function$;

-- 2) delete_server_hard
CREATE OR REPLACE FUNCTION public.delete_server_hard(p_tenant_id uuid, p_server_id uuid, p_created_by uuid)
 RETURNS TABLE(deleted_server integer, deleted_clients integer, deleted_client_renewals integer, deleted_reseller_servers integer, deleted_credit_purchases integer, deleted_credit_sales integer, deleted_credit_usage integer, deleted_server_events integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_archived boolean;
  v_tenant_id uuid;
  v_active_clients integer;
  v_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_created_by is null or p_created_by <> auth.uid() then
    raise exception 'Invalid created_by';
  end if;

  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select s.is_archived, s.tenant_id
    into v_is_archived, v_tenant_id
  from public.servers s
  where s.id = p_server_id;

  if not found then
    raise exception 'Server not found';
  end if;

  if v_tenant_id <> p_tenant_id then
    raise exception 'Server does not belong to tenant';
  end if;

  if v_is_archived is distinct from true then
    raise exception 'Hard delete allowed only for archived servers';
  end if;

  select count(*) into v_active_clients
  from public.clients
  where server_id = p_server_id
    and coalesce(is_archived, false) = false;

  if v_active_clients > 0 then
    raise exception 'Existem % cliente(s) ativo(s) (não arquivados) vinculados a este servidor. Arquive-os antes de excluir o servidor definitivamente.', v_active_clients;
  end if;

  select array_agg(id) into v_ids
  from public.clients
  where server_id = p_server_id;

  if v_ids is not null and array_length(v_ids, 1) is not null then
    if to_regclass('public.client_alerts') is not null then
      delete from public.client_alerts where client_id = any(v_ids);
    end if;

    if to_regclass('public.client_message_jobs') is not null then
      delete from public.client_message_jobs where client_id = any(v_ids);
    end if;

    if to_regclass('public.client_phones') is not null then
      delete from public.client_phones where client_id = any(v_ids);
    end if;

    if to_regclass('public.client_apps') is not null then
      delete from public.client_apps where client_id = any(v_ids);
    end if;

    if to_regclass('public.client_subscriptions') is not null then
      delete from public.client_subscriptions where client_id = any(v_ids);
    end if;

    if to_regclass('public.client_app_activity_log') is not null then
      delete from public.client_app_activity_log where client_id = any(v_ids);
    end if;

    if to_regclass('public.client_app_requests') is not null then
      delete from public.client_app_requests where client_id = any(v_ids);
    end if;

    if to_regclass('public.client_contacts') is not null then
      delete from public.client_contacts where client_id = any(v_ids);
    end if;

    if to_regclass('public.client_events') is not null then
      delete from public.client_events where client_id = any(v_ids);
    end if;

    if to_regclass('public.coupon_abuse_guard') is not null then
      delete from public.coupon_abuse_guard where client_id = any(v_ids);
    end if;

    if to_regclass('public.coupon_redemptions') is not null then
      delete from public.coupon_redemptions where client_id = any(v_ids);
    end if;

    if to_regclass('public.epg_config') is not null then
      delete from public.epg_config where client_id = any(v_ids);
    end if;

    if to_regclass('public.fin_previsao_snapshot') is not null then
      delete from public.fin_previsao_snapshot where client_id = any(v_ids);
    end if;

    if to_regclass('public.coupons') is not null then
      update public.coupons set client_id = null where client_id = any(v_ids);
    end if;

    if to_regclass('public.google_contacts') is not null then
      update public.google_contacts set client_id = null where client_id = any(v_ids);
    end if;

    if to_regclass('public.guia_tv_access_log') is not null then
      update public.guia_tv_access_log set client_id = null where client_id = any(v_ids);
    end if;
  end if;

  delete from public.server_credit_usage
  where server_id = p_server_id;
  get diagnostics deleted_credit_usage = row_count;

  delete from public.server_credit_sales
  where server_id = p_server_id;
  get diagnostics deleted_credit_sales = row_count;

  delete from public.server_credit_purchases
  where server_id = p_server_id;
  get diagnostics deleted_credit_purchases = row_count;

  delete from public.client_renewals
  where server_id = p_server_id;
  get diagnostics deleted_client_renewals = row_count;

  delete from public.clients
  where server_id = p_server_id;
  get diagnostics deleted_clients = row_count;

  delete from public.reseller_servers
  where server_id = p_server_id;
  get diagnostics deleted_reseller_servers = row_count;

  delete from public.server_events
  where server_id = p_server_id;
  get diagnostics deleted_server_events = row_count;

  delete from public.servers
  where id = p_server_id;
  get diagnostics deleted_server = row_count;

  return;
end;
$function$;
