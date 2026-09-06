-- ✅ 06/09/2026 — remove de vez o sistema de PIN do portal do cliente,
-- pedido do Márcio ("o PIN de login não existe mais, pode fazer o drop").
-- Login real hoje é 100% por token mágico (ver app/api/client-portal/
-- login/route.ts, comentário "PIN não é mais exigido no login").
--
-- ⚠️ Achado ao revisar antes de dropar: ensure_portal_credential NÃO era
-- código morto como pareceu na auditoria original (que só grepou o
-- código TypeScript) — é chamada de DENTRO de update_client e da versão
-- ativa de create_client_and_setup (oid 63950, a que o app realmente
-- usa) toda vez que um cliente é criado/editado com whatsapp_username
-- preenchido. O efeito é só um insert vestigial em
-- client_portal_credentials (PIN default = últimos 4 dígitos do
-- whatsapp) que nunca é lido por nada — mas dropar a função sem tirar
-- essas 2 chamadas quebraria a criação/edição de cliente. Por isso os 2
-- CREATE OR REPLACE abaixo vêm primeiro, removendo só esse trecho morto
-- (resto do corpo idêntico ao que já estava em produção).
--
-- As outras 5 funções (verify_portal_pin, portal_verify_pin,
-- portal_get_or_create_credentials, portal_create_reset_token,
-- portal_list_accounts, get_saldo_conta) e a tabela
-- client_portal_credentials confirmadas sem NENHUM chamador real (nem no
-- TypeScript, nem dentro de outra função do banco) — seguro dropar
-- direto.

-- ═══ 1) update_client — remove só as 2 chamadas a ensure_portal_credential ═══
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
end;
$function$;

-- ═══ 2) create_client_and_setup (versão ativa, com contato secundário) —
-- remove só as 2 chamadas a ensure_portal_credential ═══
CREATE OR REPLACE FUNCTION public.create_client_and_setup(p_tenant_id uuid, p_created_by uuid, p_display_name text, p_server_id uuid, p_server_username text, p_server_password text DEFAULT NULL::text, p_screens integer DEFAULT 1, p_plan_label text DEFAULT NULL::text, p_price_amount numeric DEFAULT 0, p_price_currency currency_code DEFAULT 'BRL'::currency_code, p_vencimento timestamp with time zone DEFAULT NULL::timestamp with time zone, p_phone_e164 text DEFAULT NULL::text, p_whatsapp_username text DEFAULT NULL::text, p_whatsapp_opt_in boolean DEFAULT true, p_whatsapp_snooze_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_clear_whatsapp_snooze_until boolean DEFAULT false, p_notes text DEFAULT NULL::text, p_app_ids uuid[] DEFAULT NULL::uuid[], p_is_trial boolean DEFAULT false, p_is_archived boolean DEFAULT false, p_technology text DEFAULT 'IPTV'::text, p_plan_table_id uuid DEFAULT NULL::uuid, p_name_prefix text DEFAULT NULL::text, p_secondary_display_name text DEFAULT NULL::text, p_secondary_name_prefix text DEFAULT NULL::text, p_secondary_first_name text DEFAULT NULL::text, p_secondary_last_name text DEFAULT NULL::text, p_secondary_phone_e164 text DEFAULT NULL::text, p_secondary_whatsapp_username text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id uuid;
  v_plan_table_id uuid;
  v_whatsapp_username text;
  v_secondary_whatsapp_username text;
  v_snooze timestamptz;
  v_technology text;
begin
  -- ✅ Validação de tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  v_whatsapp_username := nullif(btrim(coalesce(p_whatsapp_username, '')), '');
  if v_whatsapp_username is null and p_phone_e164 is not null then
    v_whatsapp_username := '@' || p_phone_e164;
  end if;

  v_secondary_whatsapp_username := nullif(btrim(coalesce(p_secondary_whatsapp_username, '')), '');
  if v_secondary_whatsapp_username is null and p_secondary_phone_e164 is not null then
    v_secondary_whatsapp_username := '@' || p_secondary_phone_e164;
  end if;

  if coalesce(p_clear_whatsapp_snooze_until, false) then
    v_snooze := null;
  else
    v_snooze := p_whatsapp_snooze_until;
  end if;

  v_technology := nullif(btrim(coalesce(p_technology, 'IPTV')), '');
  if v_technology is null then
    v_technology := 'IPTV';
  end if;

  v_plan_table_id := p_plan_table_id;
  if v_plan_table_id is null then
    select pt.id into v_plan_table_id from public.plan_tables pt
    where pt.tenant_id = p_tenant_id and pt.is_active = true
      and pt.is_system_default = true and pt.currency = coalesce(p_price_currency, 'BRL'::currency_code) limit 1;
  end if;
  if v_plan_table_id is null then
    select pt.id into v_plan_table_id from public.plan_tables pt
    where pt.tenant_id = p_tenant_id and pt.is_active = true
      and pt.is_system_default = true and pt.currency = 'BRL'::public.currency_code limit 1;
  end if;

  insert into public.clients (
    tenant_id, created_by, display_name, name_prefix, first_name, last_name, notes,
    server_id, server_username, server_password,
    vencimento, is_trial, screens, plan_label, price_amount, price_currency, plan_table_id,
    whatsapp_opt_in, whatsapp_username, whatsapp_snooze_until, phone_e164,
    secondary_display_name, secondary_name_prefix, secondary_first_name, secondary_last_name,
    secondary_phone_e164, secondary_whatsapp_username,
    is_archived, archived_at, purge_after, technology, created_at, updated_at
  )
  values (
    p_tenant_id, p_created_by, p_display_name, p_name_prefix,
    split_part(btrim(p_display_name), ' ', 1),
    nullif(btrim(substring(btrim(p_display_name) from length(split_part(btrim(p_display_name), ' ', 1)) + 2)), ''),
    p_notes,
    p_server_id, p_server_username, p_server_password,
    p_vencimento, p_is_trial, p_screens, p_plan_label, p_price_amount, coalesce(p_price_currency, 'BRL'::currency_code), v_plan_table_id,
    p_whatsapp_opt_in, v_whatsapp_username, v_snooze, p_phone_e164,
    p_secondary_display_name, p_secondary_name_prefix,
    split_part(btrim(p_secondary_display_name), ' ', 1),
    nullif(btrim(substring(btrim(p_secondary_display_name) from length(split_part(btrim(p_secondary_display_name), ' ', 1)) + 2)), ''),
    p_secondary_phone_e164, v_secondary_whatsapp_username,
    p_is_archived, case when p_is_archived then now() else null end, null, v_technology, now(), now()
  )
  returning id into v_client_id;

  if p_app_ids is not null and array_length(p_app_ids, 1) is not null then
    insert into public.client_apps (tenant_id, client_id, app_id)
    select p_tenant_id, v_client_id, x.app_id
    from unnest(p_app_ids) as x(app_id)
    on conflict do nothing;
  end if;

  return v_client_id;
end;
$function$;

-- ═══ 3) dropa o sistema de PIN em si (ordem: quem depende primeiro) ═══
DROP FUNCTION IF EXISTS public.portal_verify_pin(uuid, text, text);
DROP FUNCTION IF EXISTS public.verify_portal_pin(uuid, text, text);
DROP FUNCTION IF EXISTS public.portal_get_or_create_credentials(uuid, text);
DROP FUNCTION IF EXISTS public.ensure_portal_credential(uuid, text);
DROP FUNCTION IF EXISTS public.portal_create_reset_token(uuid, text, integer);
DROP FUNCTION IF EXISTS public.portal_list_accounts(text);
DROP FUNCTION IF EXISTS public.get_saldo_conta(uuid);
DROP TABLE IF EXISTS public.client_portal_credentials;

-- Helpers que só existiam pra dar suporte ao sistema de PIN acima
-- (confirmado: nenhum outro chamador nem constraint usa nenhum dos 2).
DROP FUNCTION IF EXISTS public.default_pin_from_whatsapp(text);
DROP FUNCTION IF EXISTS public.is_valid_pin(text);
