-- ✅ 05/09/2026: Márcio pediu pra simplificar o front de volta ao que
-- sempre foi (Ativos + Lixeira, sem tela/filtro separado de "Arquivado").
-- O campo deep_archived_at e o cron continuam existindo (retenção fiscal),
-- só o comportamento visível/manual muda:
--
-- 1) delete_client_forever volta a exigir só is_archived=true (como
--    sempre foi) -- o botão "Excluir definitivamente" da Lixeira volta a
--    funcionar sem depender de deep_archived_at. A confirmação extra
--    sobre o fisco agora é só no front (popup adicional antes deste RPC).
-- 2) update_client: quando o admin restaura um cliente (p_is_archived =
--    false explícito), limpa deep_archived_at junto -- antes isso era
--    feito por uma chamada separada no front (clear_deep_archived), que
--    foi removida da tela; agora fica garantido no próprio RPC de
--    restauração, então não depende mais do front lembrar de fazer isso.

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

  select c.is_archived
    into v_is_archived
  from public.clients c
  where c.tenant_id = p_tenant_id
    and c.id = p_client_id;

  if not found then
    raise exception 'Cliente não encontrado para este tenant.'
      using errcode = 'P0001';
  end if;

  if not coalesce(v_is_archived, false) then
    raise exception 'Só é possível excluir definitivamente pela Lixeira.'
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

CREATE OR REPLACE FUNCTION public.update_client(p_tenant_id uuid, p_client_id uuid, p_display_name text DEFAULT NULL::text, p_name_prefix text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_clear_notes boolean DEFAULT false, p_server_id uuid DEFAULT NULL::uuid, p_server_username text DEFAULT NULL::text, p_server_password text DEFAULT NULL::text, p_screens integer DEFAULT NULL::integer, p_plan_label text DEFAULT NULL::text, p_price_amount numeric DEFAULT NULL::numeric, p_price_currency currency_code DEFAULT NULL::currency_code, p_vencimento timestamp with time zone DEFAULT NULL::timestamp with time zone, p_is_trial boolean DEFAULT NULL::boolean, p_whatsapp_opt_in boolean DEFAULT NULL::boolean, p_whatsapp_username text DEFAULT NULL::text, p_whatsapp_snooze_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_is_archived boolean DEFAULT NULL::boolean, p_technology text DEFAULT NULL::text, p_clear_whatsapp_snooze_until boolean DEFAULT false, p_plan_table_id uuid DEFAULT NULL::uuid, p_phone_e164 text DEFAULT NULL::text, p_secondary_display_name text DEFAULT NULL::text, p_secondary_name_prefix text DEFAULT NULL::text, p_secondary_first_name text DEFAULT NULL::text, p_secondary_last_name text DEFAULT NULL::text, p_secondary_phone_e164 text DEFAULT NULL::text, p_secondary_whatsapp_username text DEFAULT NULL::text, p_clear_secondary boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_allowed boolean;
begin
  -- Validação de segurança de tenant
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
  ) into v_allowed;

  if not v_allowed then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_display_name is not null and btrim(p_display_name) = '' then
    raise exception 'DISPLAY_NAME_INVALID';
  end if;

  if p_screens is not null and p_screens <= 0 then
    raise exception 'SCREENS_INVALID';
  end if;

  if p_price_amount is not null and p_price_amount < 0 then
    raise exception 'PRICE_AMOUNT_INVALID';
  end if;

  update public.clients c
  set
    display_name = coalesce(p_display_name, c.display_name),
    first_name = case
        when p_display_name is not null then split_part(btrim(p_display_name), ' ', 1)
        else c.first_name
    end,
    last_name = case
        when p_display_name is not null then nullif(btrim(substring(btrim(p_display_name) from length(split_part(btrim(p_display_name), ' ', 1)) + 2)), '')
        else c.last_name
    end,
    name_prefix  = coalesce(p_name_prefix, c.name_prefix),
    notes = case when p_clear_notes then null else coalesce(p_notes, c.notes) end,
    server_id       = coalesce(p_server_id, c.server_id),
    server_username = coalesce(p_server_username, c.server_username),
    server_password = coalesce(p_server_password, c.server_password),
    screens        = coalesce(p_screens, c.screens),
    plan_label     = coalesce(p_plan_label, c.plan_label),
    price_amount   = coalesce(p_price_amount, c.price_amount),
    price_currency = coalesce(p_price_currency, c.price_currency),
    plan_table_id = coalesce(p_plan_table_id, c.plan_table_id),
    vencimento = coalesce(p_vencimento, c.vencimento),
    is_trial   = coalesce(p_is_trial, c.is_trial),
    whatsapp_opt_in   = coalesce(p_whatsapp_opt_in, c.whatsapp_opt_in),
    whatsapp_username = coalesce(p_whatsapp_username, c.whatsapp_username),
    phone_e164 = coalesce(p_phone_e164, c.phone_e164),

    -- Ajustes do contato secundário
    secondary_display_name = case when p_clear_secondary then null else coalesce(p_secondary_display_name, c.secondary_display_name) end,
    secondary_name_prefix = case when p_clear_secondary then null else coalesce(p_secondary_name_prefix, c.secondary_name_prefix) end,
    secondary_first_name = case
        when p_clear_secondary then null
        when p_secondary_display_name is not null then split_part(btrim(p_secondary_display_name), ' ', 1)
        else coalesce(p_secondary_first_name, c.secondary_first_name)
    end,
    secondary_last_name = case
        when p_clear_secondary then null
        when p_secondary_display_name is not null then nullif(btrim(substring(btrim(p_secondary_display_name) from length(split_part(btrim(p_secondary_display_name), ' ', 1)) + 2)), '')
        else coalesce(p_secondary_last_name, c.secondary_last_name)
    end,
    secondary_phone_e164 = case when p_clear_secondary then null else coalesce(p_secondary_phone_e164, c.secondary_phone_e164) end,
    secondary_whatsapp_username = case when p_clear_secondary then null else coalesce(p_secondary_whatsapp_username, c.secondary_whatsapp_username) end,

    whatsapp_snooze_until = case when p_clear_whatsapp_snooze_until then null else coalesce(p_whatsapp_snooze_until, c.whatsapp_snooze_until) end,
    is_archived = coalesce(p_is_archived, c.is_archived),
    technology  = coalesce(p_technology, c.technology),
    archived_at = case when coalesce(p_is_archived, c.is_archived) = true then coalesce(c.archived_at, now()) else null end,
    purge_after = case when coalesce(p_is_archived, c.is_archived) = true then c.purge_after else null end,
    -- ✅ 05/09/2026: restaurar da Lixeira (p_is_archived = false explícito)
    -- também limpa deep_archived_at -- sem isso o cliente voltaria pra
    -- lista ativa mas continuaria invisível no Portal.
    deep_archived_at = case when p_is_archived = false then null else c.deep_archived_at end,
    updated_at = now()
  where c.id = p_client_id
    and c.tenant_id = p_tenant_id;

  if p_is_trial = false then
    update public.papa_testes pt
    set converted = true, converted_at = now()
    from public.clients c4
    where c4.id = p_client_id
      and pt.tenant_id = p_tenant_id
      and pt.converted = false
      and pt.whatsapp_username = c4.whatsapp_username
      and pt.username = c4.server_username;
  end if;

  if p_whatsapp_username is not null then
    perform public.ensure_portal_credential(p_tenant_id, p_whatsapp_username);
  end if;

  if p_secondary_whatsapp_username is not null and not coalesce(p_clear_secondary, false) then
    perform public.ensure_portal_credential(p_tenant_id, p_secondary_whatsapp_username);
  end if;

end;
$function$;
