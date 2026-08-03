-- Bug: excluir cliente da Lixeira falhava com "Não foi possível excluir o
-- cliente" (erro genérico de FK violation engolido pelo client).
--
-- Causa raiz: delete_client_forever só limpava 5 tabelas filhas
-- (client_alerts, client_message_jobs, client_phones, client_apps,
-- client_subscriptions) antes do DELETE final em public.clients. Só que
-- hoje existem 15 tabelas com FK pra clients — client_phones e
-- client_message_jobs nem existem mais (viraram client_contacts e outra
-- coisa), então esses dois blocos eram no-ops silenciosos via to_regclass.
-- As tabelas novas nunca ganharam limpeza: client_app_activity_log,
-- client_app_requests, client_contacts, client_events, client_renewals,
-- coupon_abuse_guard, coupon_redemptions, coupons, epg_config,
-- fin_previsao_snapshot, google_contacts, guia_tv_access_log,
-- server_credit_usage. Qualquer cliente arquivado com registro em uma
-- dessas tabelas batia em FOREIGN KEY VIOLATION e a exclusão definitiva
-- falhava.
--
-- Fix: adicionar limpeza de todas as tabelas. Pra tabelas que são
-- puramente "sobre" o cliente (log de atividade, pedidos de app, contatos,
-- eventos, histórico de renovação, guarda de abuso de cupom, resgates de
-- cupom, config de EPG) fazemos DELETE mesmo — não faz sentido manter
-- órfão. Pra tabelas onde client_id é nullable e o registro tem valor
-- histórico/financeiro por si só (snapshot financeiro, contato do Google
-- sincronizado, log de acesso ao guia de TV, uso de crédito de servidor,
-- cupom pessoal), fazemos UPDATE ... SET client_id = NULL em vez de
-- excluir a linha, preservando o histórico.

CREATE OR REPLACE FUNCTION public.delete_client_forever(p_tenant_id uuid, p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_archived boolean;
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select coalesce(c.is_archived, false)
    into v_is_archived
  from public.clients c
  where c.tenant_id = p_tenant_id
    and c.id = p_client_id;

  if not found then
    raise exception 'Cliente não encontrado para este tenant.'
      using errcode = 'P0001';
  end if;

  if v_is_archived is distinct from true then
    raise exception 'Só é permitido excluir definitivamente clientes arquivados (na Lixeira).'
      using errcode = 'P0001';
  end if;

  -- tabelas filhas "puras" (registro só existe por causa do cliente): apaga
  if to_regclass('public.client_alerts') is not null then
    execute 'delete from public.client_alerts where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  if to_regclass('public.client_message_jobs') is not null then
    execute 'delete from public.client_message_jobs where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  if to_regclass('public.client_phones') is not null then
    execute 'delete from public.client_phones where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  if to_regclass('public.client_apps') is not null then
    execute 'delete from public.client_apps where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  if to_regclass('public.client_subscriptions') is not null then
    execute 'delete from public.client_subscriptions where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  if to_regclass('public.client_app_activity_log') is not null then
    execute 'delete from public.client_app_activity_log where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  if to_regclass('public.client_app_requests') is not null then
    execute 'delete from public.client_app_requests where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  if to_regclass('public.client_contacts') is not null then
    execute 'delete from public.client_contacts where client_id = $1'
      using p_client_id;
  end if;

  if to_regclass('public.client_events') is not null then
    execute 'delete from public.client_events where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  if to_regclass('public.client_renewals') is not null then
    execute 'delete from public.client_renewals where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  if to_regclass('public.coupon_abuse_guard') is not null then
    execute 'delete from public.coupon_abuse_guard where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  if to_regclass('public.coupon_redemptions') is not null then
    execute 'delete from public.coupon_redemptions where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  if to_regclass('public.epg_config') is not null then
    execute 'delete from public.epg_config where client_id = $1'
      using p_client_id;
  end if;

  -- fin_previsao_snapshot tem CHECK XOR (transacao_id, client_id): linhas
  -- "iptv_a_receber" só existem por causa do client_id (não têm
  -- transacao_id), então SET NULL violaria a constraint. Apaga.
  if to_regclass('public.fin_previsao_snapshot') is not null then
    execute 'delete from public.fin_previsao_snapshot where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  -- tabelas com valor histórico/financeiro próprio (client_id é nullable
  -- por design): desvincula em vez de apagar
  if to_regclass('public.coupons') is not null then
    execute 'update public.coupons set client_id = null where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  if to_regclass('public.google_contacts') is not null then
    execute 'update public.google_contacts set client_id = null where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  if to_regclass('public.guia_tv_access_log') is not null then
    execute 'update public.guia_tv_access_log set client_id = null where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  if to_regclass('public.server_credit_usage') is not null then
    execute 'update public.server_credit_usage set client_id = null where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

  delete from public.clients
  where tenant_id = p_tenant_id
    and id = p_client_id;

  if not found then
    raise exception 'Falha ao excluir: cliente não encontrado no momento da remoção.'
      using errcode = 'P0001';
  end if;
end;
$function$;
