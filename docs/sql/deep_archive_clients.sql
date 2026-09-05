-- ✅ 05/09/2026, pedido do Márcio: ninguém mais é deletado de verdade no
-- ciclo normal. Cliente REAL (não-trial) vencido há 61+ dias deixa de ser
-- apagado pelo purge diário -- passa a virar "Arquivado" (deep_archived),
-- preservando 100% do cadastro e histórico (nenhuma tabela filha é tocada).
-- Motivo: Reforma Tributária / NFS-e (docs/fiscal/nota-fiscal-reforma-
-- tributaria-2027.md) exige guardar comprovante de pagamento por 5 anos,
-- e isso só funciona se o cliente ligado ao pagamento continuar existindo.
--
-- Trial continua EXATAMENTE como hoje -- nunca pagou nada, sem obrigação
-- fiscal, pode ser apagado de verdade (mesmo código de sempre, só
-- reorganizado nesta função).
--
-- Exclusão definitiva de um "Arquivado" (deep_archived) continua possível
-- -- só não é mais automática. É uma ação manual do admin, sem trava de
-- tempo (só confirmação na tela), via delete_client_forever() (já existia,
-- só mudou a trava — ver mais abaixo).

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS deep_archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_clients_deep_archived_at
  ON public.clients (tenant_id, deep_archived_at)
  WHERE deep_archived_at IS NOT NULL;

-- ─── Purge diário: trial deleta de verdade, real vira deep_archived ───────
CREATE OR REPLACE FUNCTION public.auto_purge_expired_clients()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_trial_ids uuid[];
  v_real_ids uuid[];
begin
  -- Trial: comportamento INALTERADO (delete físico de verdade).
  select array_agg(c.id) into v_trial_ids
  from public.clients c
  where c.is_archived = true
    and c.is_trial = true
    and c.vencimento is not null
    and (c.vencimento AT TIME ZONE 'America/Sao_Paulo')::date
          <= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 7;

  if v_trial_ids is not null and array_length(v_trial_ids, 1) > 0 then
    if to_regclass('public.client_alerts') is not null then
      delete from public.client_alerts where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.client_message_jobs') is not null then
      delete from public.client_message_jobs where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.client_phones') is not null then
      delete from public.client_phones where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.client_apps') is not null then
      delete from public.client_apps where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.client_subscriptions') is not null then
      delete from public.client_subscriptions where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.client_app_activity_log') is not null then
      delete from public.client_app_activity_log where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.client_app_requests') is not null then
      delete from public.client_app_requests where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.client_contacts') is not null then
      delete from public.client_contacts where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.client_events') is not null then
      delete from public.client_events where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.client_renewals') is not null then
      delete from public.client_renewals where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.coupon_abuse_guard') is not null then
      delete from public.coupon_abuse_guard where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.coupon_redemptions') is not null then
      delete from public.coupon_redemptions where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.epg_config') is not null then
      delete from public.epg_config where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.fin_previsao_snapshot') is not null then
      delete from public.fin_previsao_snapshot where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.coupons') is not null then
      update public.coupons set client_id = null where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.google_contacts') is not null then
      update public.google_contacts set client_id = null where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.guia_tv_access_log') is not null then
      update public.guia_tv_access_log set client_id = null where client_id = any(v_trial_ids);
    end if;
    if to_regclass('public.server_credit_usage') is not null then
      update public.server_credit_usage set client_id = null where client_id = any(v_trial_ids);
    end if;

    delete from public.clients where id = any(v_trial_ids);
  end if;

  -- Real (não-trial): vira "Arquivado" (deep_archived) -- NADA é apagado.
  select array_agg(c.id) into v_real_ids
  from public.clients c
  where c.is_archived = true
    and coalesce(c.is_trial, false) = false
    and c.deep_archived_at is null
    and c.vencimento is not null
    and (c.vencimento AT TIME ZONE 'America/Sao_Paulo')::date
          <= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 61;

  if v_real_ids is not null and array_length(v_real_ids, 1) > 0 then
    update public.clients
    set deep_archived_at = now(),
        updated_at = now()
    where id = any(v_real_ids);
  end if;
end;
$function$;

-- ─── Exclusão manual definitiva de um "Arquivado" (deep_archived) ─────────
-- ✅ Achado ao ler o código antes de duplicar: já existia delete_client_
-- forever(p_tenant_id, p_client_id) — mesmo cascade delete, mas com
-- checagem de tenant_members (auth.uid()) que uma função nova daqui não
-- teria. Só a TRAVA mudou: antes bastava is_archived=true (qualquer um na
-- Lixeira); agora exige deep_archived_at preenchido (só quem já é
-- "Arquivado" de verdade). Sem trava de TEMPO (pedido do Márcio: às vezes
-- cria clientes de teste e não faz sentido travar a exclusão deles) — a
-- confirmação fica só na tela (useConfirm), como já era.
-- Ver alteração completa em app/admin/cliente (RPC já usada pelo botão
-- "Excluir definitivamente" existente).

-- ─── Portal: identidade nunca resolve pra um cliente deep_archived ────────
CREATE OR REPLACE FUNCTION public.portal_client_ids_for_identity(p_tenant_id uuid, p_whatsapp_username text, p_phone_anchor text DEFAULT NULL::text)
 RETURNS TABLE(id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id
  FROM public.clients c
  WHERE c.tenant_id = p_tenant_id
    AND c.deep_archived_at IS NULL
    AND (
      public.normalize_phone(c.whatsapp_username) = public.normalize_phone(p_whatsapp_username)
      OR public.normalize_phone(c.secondary_whatsapp_username) = public.normalize_phone(p_whatsapp_username)
      OR (p_phone_anchor IS NOT NULL AND public.normalize_phone(c.phone_e164) = p_phone_anchor)
      OR (p_phone_anchor IS NOT NULL AND public.normalize_phone(c.secondary_phone_e164) = p_phone_anchor)
    );
$function$;
-- ✅ 05/09/2026: delete_client_forever já existia e fazia exatamente o
-- cascade delete que precisávamos -- só a trava mudou (antes: qualquer
-- arquivado na Lixeira; agora: só quem já é "Arquivado" de verdade,
-- deep_archived_at preenchido). admin_delete_deep_archived_client (nova,
-- redundante e sem a checagem de tenant_members que esta já tinha) foi
-- descartada.
CREATE OR REPLACE FUNCTION public.delete_client_forever(p_tenant_id uuid, p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_deep_archived_at timestamptz;
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select c.deep_archived_at
    into v_deep_archived_at
  from public.clients c
  where c.tenant_id = p_tenant_id
    and c.id = p_client_id;

  if not found then
    raise exception 'Cliente não encontrado para este tenant.'
      using errcode = 'P0001';
  end if;

  if v_deep_archived_at is null then
    raise exception 'Só é permitido excluir definitivamente clientes em Arquivado (dentro da Lixeira).'
      using errcode = 'P0001';
  end if;

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

  if to_regclass('public.fin_previsao_snapshot') is not null then
    execute 'delete from public.fin_previsao_snapshot where tenant_id = $1 and client_id = $2'
      using p_tenant_id, p_client_id;
  end if;

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

DROP FUNCTION IF EXISTS public.admin_delete_deep_archived_client(uuid);
