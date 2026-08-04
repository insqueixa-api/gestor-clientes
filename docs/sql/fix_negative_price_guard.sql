-- Trava contra valor negativo em update_client (p_price_amount) e
-- renew_client_and_log (p_unit_price/p_total_amount) — nada no banco
-- impedia um "-" digitado sem querer no campo de valor do modal de
-- renovação (app/admin/cliente/recarga_cliente.tsx) de corromper
-- clients.price_amount e/ou client_renewals.unit_price/total_amount.
-- Já existia validação client-side pro mesmo caso (handlePreCheck e
-- executeSave), mas essas duas funções são SECURITY DEFINER chamadas
-- direto do navegador — trava só no front não é suficiente (defesa em
-- profundidade, mesmo padrão de DISPLAY_NAME_INVALID/SCREENS_INVALID que
-- update_client já tinha pra outros campos).
--
-- Único trecho alterado em cada função: uma nova validação logo depois
-- das que já existiam. Resto idêntico ao que já estava em produção.

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
    updated_at = now()
  where c.id = p_client_id
    and c.tenant_id = p_tenant_id;

  -- ✅ NOVO: quando um teste vira cliente de verdade (p_is_trial = false explícito),
  -- marca o histórico de testes (papa_testes) como convertido. Casa por WhatsApp +
  -- USERNAME exato (não só servidor) — a mesma pessoa pode ter mais de um teste no
  -- mesmo servidor com usuários diferentes, e só o teste com o username que virou
  -- cliente de verdade deve mostrar "Convertido".
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

  -- GERA AS CREDENCIAIS CASO UM WHATSAPP TENHA SIDO ADICIONADO/ALTERADO NO UPDATE
  if p_whatsapp_username is not null then
    perform public.ensure_portal_credential(p_tenant_id, p_whatsapp_username);
  end if;

  if p_secondary_whatsapp_username is not null and not coalesce(p_clear_secondary, false) then
    perform public.ensure_portal_credential(p_tenant_id, p_secondary_whatsapp_username);
  end if;

end;
$function$;

CREATE OR REPLACE FUNCTION public.renew_client_and_log(p_tenant_id uuid, p_client_id uuid, p_months integer, p_status text, p_notes text, p_new_vencimento timestamp with time zone DEFAULT NULL::timestamp with time zone, p_message text DEFAULT NULL::text, p_unit_price numeric DEFAULT NULL::numeric, p_total_amount numeric DEFAULT NULL::numeric, p_is_automatic boolean DEFAULT NULL::boolean)
 RETURNS TABLE(client_id uuid, server_id uuid, old_vencimento timestamp with time zone, new_vencimento timestamp with time zone, screens integer, credits_base integer, credits_used numeric, balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_server_id             uuid;
  v_screens               int;
  v_old_expires_at        timestamptz;
  v_base_date             timestamptz;
  v_new_expires_at        timestamptz;
  v_currency              public.currency_code;
  v_price_amount          numeric;
  v_plan_table_id         uuid;
  v_client_plan_table_id  uuid;
  v_period                text;
  v_credits_base          int;
  v_credits_used          numeric(18,6);
  v_message               text;
  v_balance               numeric(18,6);
  v_client_display_name   text;
  v_is_automatic          boolean;
BEGIN
  IF p_months NOT IN (1,2,3,6,12) THEN
    RAISE EXCEPTION 'Meses inválidos: %. Use 1,2,3,6,12.', p_months;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_TENANT';
  END IF;

  IF p_unit_price IS NOT NULL AND p_unit_price < 0 THEN
    RAISE EXCEPTION 'UNIT_PRICE_INVALID';
  END IF;

  IF p_total_amount IS NOT NULL AND p_total_amount < 0 THEN
    RAISE EXCEPTION 'TOTAL_AMOUNT_INVALID';
  END IF;

  SELECT
    c.server_id, c.screens, c.vencimento,
    c.price_amount, c.price_currency, c.plan_table_id,
    coalesce(c.display_name, c.server_username, 'Cliente')
  INTO
    v_server_id, v_screens, v_old_expires_at,
    v_price_amount, v_currency, v_client_plan_table_id,
    v_client_display_name
  FROM public.clients c
  WHERE c.id = p_client_id AND c.tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_server_id IS NULL THEN
    RAISE EXCEPTION 'CLIENT_NOT_FOUND_OR_NO_SERVER';
  END IF;

  v_period := CASE p_months
    WHEN 1  THEN 'MONTHLY'
    WHEN 2  THEN 'BIMONTHLY'
    WHEN 3  THEN 'QUARTERLY'
    WHEN 6  THEN 'SEMIANNUAL'
    WHEN 12 THEN 'ANNUAL'
  END;

  -- ✅ NOVA LÓGICA: data e flag de automático desacopladas
  IF p_new_vencimento IS NOT NULL THEN
    v_new_expires_at := p_new_vencimento;
  ELSE
    v_base_date := CASE
      WHEN v_old_expires_at IS NOT NULL AND v_old_expires_at > now() THEN v_old_expires_at
      ELSE now()
    END;
    v_new_expires_at := v_base_date + make_interval(months => p_months);
  END IF;

  -- p_is_automatic explícito tem prioridade; fallback = se veio data sem override manual
  v_is_automatic := COALESCE(p_is_automatic, p_new_vencimento IS NOT NULL);

  SELECT pt.id INTO v_plan_table_id
  FROM public.plan_tables pt
  WHERE pt.tenant_id = p_tenant_id AND pt.is_active = true
    AND pt.is_system_default = true AND pt.currency = v_currency
  LIMIT 1;

  IF v_plan_table_id IS NULL THEN
    SELECT pt.id INTO v_plan_table_id
    FROM public.plan_tables pt
    WHERE pt.tenant_id = p_tenant_id AND pt.is_active = true
      AND pt.is_system_default = true AND pt.currency = 'BRL'::public.currency_code
    LIMIT 1;
  END IF;

  IF v_plan_table_id IS NULL THEN
    RAISE EXCEPTION 'DEFAULT_PLAN_TABLE_NOT_FOUND';
  END IF;

  IF v_client_plan_table_id IS NOT NULL THEN
    PERFORM 1 FROM public.plan_tables pt
    WHERE pt.id = v_client_plan_table_id AND pt.tenant_id = p_tenant_id AND pt.is_active = true;
    IF FOUND THEN v_plan_table_id := v_client_plan_table_id; END IF;
  END IF;

  SELECT pti.credits_base INTO v_credits_base
  FROM public.plan_table_items pti
  WHERE pti.plan_table_id = v_plan_table_id AND pti.period::text = v_period
  LIMIT 1;

  v_credits_base := coalesce(v_credits_base, 0);
  v_credits_used := v_credits_base * greatest(1, coalesce(v_screens, 1));

  IF NOT v_is_automatic THEN
    UPDATE public.servers s
    SET credits_available = s.credits_available - v_credits_used, updated_at = now()
    WHERE s.id = v_server_id AND s.tenant_id = p_tenant_id
      AND s.credits_available >= v_credits_used;

    IF NOT FOUND THEN RAISE EXCEPTION 'INSUFFICIENT_SERVER_CREDITS'; END IF;
  END IF;

  UPDATE public.clients c
  SET vencimento = v_new_expires_at, updated_at = now()
  WHERE c.id = p_client_id AND c.tenant_id = p_tenant_id;

  IF p_message IS NOT NULL AND btrim(p_message) <> '' THEN
    v_message := p_message;
  ELSE
    v_message :=
      'Renovação registrada. Meses: ' || p_months::text
      || '. Telas: ' || greatest(1, coalesce(v_screens, 1))::text
      || '. Vencimento: ' || to_char(v_new_expires_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI');
    IF coalesce(v_price_amount, 0) > 0 THEN
      v_message := v_message
        || '. Valor: ' || to_char(v_price_amount, 'FM999G999G990D00')
        || ' ' || v_currency::text;
    END IF;
  END IF;

  INSERT INTO public.client_renewals (
    tenant_id, client_id, server_id,
    months, screens, currency,
    unit_price, total_amount,
    credits_per_month, credits_used,
    status, notes
  ) VALUES (
    p_tenant_id, p_client_id, v_server_id,
    p_months, v_screens, v_currency,
    COALESCE(p_unit_price, v_price_amount),
    COALESCE(p_total_amount, v_price_amount * p_months),
    v_credits_base, v_credits_used,
    p_status,
    CASE
      WHEN p_notes IS NOT NULL AND btrim(p_notes) <> '' THEN v_message || ' · Obs: ' || p_notes
      ELSE v_message
    END
  );

  INSERT INTO public.client_events (tenant_id, client_id, event_type, message, meta)
  VALUES (
    p_tenant_id, p_client_id, 'RENEWAL', v_message,
    jsonb_build_object(
      'months',         p_months,
      'old_vencimento', v_old_expires_at,
      'new_vencimento', v_new_expires_at,
      'screens',        v_screens,
      'currency',       v_currency,
      'credits_base',   v_credits_base,
      'credits_used',   v_credits_used,
      'unit_price',     coalesce(p_unit_price, v_price_amount),
      'total_amount',   coalesce(p_total_amount, v_price_amount * p_months),
      'is_automatic',   v_is_automatic
    )
  );

  IF NOT v_is_automatic THEN
    INSERT INTO public.server_events (tenant_id, server_id, event_type, message, meta)
    VALUES (
      p_tenant_id, v_server_id, 'RENEWAL_DEBIT',
      format(
        'Débito · Renovação cliente %s · %s tela%s · %s créditos',
        v_client_display_name,
        greatest(1, coalesce(v_screens, 1)),
        CASE WHEN greatest(1, coalesce(v_screens, 1)) = 1 THEN '' ELSE 's' END,
        v_credits_used::int
      ),
      jsonb_build_object(
        'client_id',    p_client_id,
        'client_name',  v_client_display_name,
        'months',       p_months,
        'screens',      v_screens,
        'credits_used', v_credits_used,
        'unit_price',   coalesce(p_unit_price, v_price_amount),
        'total_amount', coalesce(p_total_amount, v_price_amount * p_months)
      )
    );
  END IF;

  SELECT coalesce(s.credits_available, 0) INTO v_balance
  FROM public.servers s
  WHERE s.id = v_server_id AND s.tenant_id = p_tenant_id;

  RETURN QUERY SELECT
    p_client_id, v_server_id,
    v_old_expires_at, v_new_expires_at,
    v_screens, v_credits_base, v_credits_used, v_balance;
END;
$function$;
