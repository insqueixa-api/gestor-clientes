-- Supabase Advisor: "Public Can Execute SECURITY DEFINER Function" (anon) e
-- "Signed-In Users Can Execute SECURITY DEFINER Function" (authenticated).
--
-- Achado real e grave: várias funções SECURITY DEFINER que recebem
-- p_tenant_id como parâmetro NUNCA verificavam se quem está chamando de fato
-- pertence àquele tenant — usavam SECURITY DEFINER (que ignora RLS de
-- propósito, pra poder fazer updates/deletes) mas sem nenhuma trava própria.
-- Confirmei nos logs de código que TODAS essas 15 funções são chamadas pelo
-- navegador do admin (supabaseBrowser, sessão do usuário logado) — nunca por
-- um processo interno/service-role — então a correção certa é a mesma usada
-- em outras ~15 funções do sistema (update_client, renew_client_and_log
-- etc.): checar tenant_members + auth.uid() antes de fazer qualquer coisa.
--
-- Sem essa correção, hoje, um usuário (autenticado com QUALQUER conta, ou
-- até anônimo em alguns casos) que soubesse/adivinhasse um tenant_id +
-- id de registro conseguiria, via /rest/v1/rpc/<funcao>:
--  - aprovar pagamentos manuais falsos (approve_manual_payment)
--  - marcar qualquer pagamento como concluído (update_fulfillment_status)
--  - pausar/parar a cobrança automática de qualquer tenant (billing_control_automation)
--  - mandar mensagem de WhatsApp arbitrária em nome de um cliente de outro tenant (client_message_send_now)
--  - apagar clientes, servidores e revendas arquivados de qualquer tenant
--  - injetar compras/vendas de créditos falsas na ficha financeira de qualquer tenant

-- 1) delete_client_forever
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

  delete from public.clients
  where tenant_id = p_tenant_id
    and id = p_client_id;

  if not found then
    raise exception 'Falha ao excluir: cliente não encontrado no momento da remoção.'
      using errcode = 'P0001';
  end if;
end;
$function$;

-- 2) approve_manual_payment
CREATE OR REPLACE FUNCTION public.approve_manual_payment(p_log_id uuid, p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE client_portal_payments
  SET
    status = 'manual_approved',
    updated_at = NOW()
  WHERE id = p_log_id AND tenant_id = p_tenant_id;
END;
$function$;

-- 3) update_fulfillment_status
CREATE OR REPLACE FUNCTION public.update_fulfillment_status(p_log_id uuid, p_tenant_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE client_portal_payments
  SET
    fulfillment_status = p_status,
    fulfilled_at = CASE
      WHEN p_status IN ('done', 'manual_done') THEN NOW()
      ELSE fulfilled_at
    END,
    updated_at = NOW()
  WHERE id = p_log_id AND tenant_id = p_tenant_id;
END;
$function$;

-- 4) billing_control_automation
CREATE OR REPLACE FUNCTION public.billing_control_automation(p_tenant_id uuid, p_automation_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_status text;
  v_fire_date date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_action = 'PLAY' then v_status := 'RUNNING';
  elsif p_action = 'PAUSE' then v_status := 'PAUSED';
  elsif p_action = 'STOP' then v_status := 'IDLE';
  else
    raise exception 'Invalid action: %', p_action;
  end if;

  update public.billing_automations
     set execution_status = v_status
   where tenant_id = p_tenant_id
     and id = p_automation_id;

  if p_action = 'STOP' then
    update public.billing_queue
       set status = 'CANCELED'::public.billing_job_status
     where tenant_id = p_tenant_id
       and automation_id = p_automation_id
       and fire_date = v_fire_date
       and status in ('PENDING'::public.billing_job_status, 'CLAIMED'::public.billing_job_status);
  end if;
end;
$function$;

-- 5) client_message_send_now
CREATE OR REPLACE FUNCTION public.client_message_send_now(p_tenant_id uuid, p_client_id uuid, p_message text, p_whatsapp_session text DEFAULT 'default'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'Mensagem vazia.';
  end if;

  insert into public.client_message_jobs (
    tenant_id, client_id, whatsapp_session, message, send_at, status, queued_at
  )
  values (
    p_tenant_id, p_client_id, p_whatsapp_session, p_message, now(), 'QUEUED', now()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

-- 6) update_whatsapp_status
CREATE OR REPLACE FUNCTION public.update_whatsapp_status(p_log_id uuid, p_tenant_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE client_portal_payments
  SET whatsapp_status = p_status
  WHERE id = p_log_id AND tenant_id = p_tenant_id;
END;
$function$;

-- 7) check_and_notify_low_credits
CREATE OR REPLACE FUNCTION public.check_and_notify_low_credits(p_tenant_id uuid, p_server_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text;
  v_credits numeric;
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select name, credits_available into v_name, v_credits
  from servers
  where id = p_server_id and tenant_id = p_tenant_id;

  if v_credits is null then
    return;
  end if;

  if v_credits <= 15 then
    insert into notifications (tenant_id, type, title, message, link, source_id)
    values (
      p_tenant_id,
      'saldo_baixo',
      '🪫 Saldo Baixo',
      'O servidor "' || v_name || '" está com apenas ' || v_credits || ' créditos. Recarregue imediatamente para evitar interrupções!',
      '/admin/gerenciador/servidor',
      p_server_id::text
    )
    on conflict (tenant_id, type, source_id)
    do update set message = excluded.message, title = excluded.title, resolved_at = null, is_read = false;
  else
    update notifications
    set resolved_at = now()
    where tenant_id = p_tenant_id
      and type = 'saldo_baixo'
      and source_id = p_server_id::text
      and resolved_at is null;
  end if;
end;
$function$;

-- 8) client_message_cancel
CREATE OR REPLACE FUNCTION public.client_message_cancel(p_tenant_id uuid, p_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.client_message_jobs
     set status = 'CANCELLED'
   where tenant_id = p_tenant_id
     and id = p_job_id
     and status in ('SCHEDULED','QUEUED');

  if not found then
    raise exception 'Nada para cancelar (já enviado/falhou ou não encontrado).';
  end if;
end;
$function$;

-- 9) delete_archived_server
CREATE OR REPLACE FUNCTION public.delete_archived_server(p_tenant_id uuid, p_server_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM servers
    WHERE id = p_server_id
    AND tenant_id = p_tenant_id
    AND is_archived = true
  ) THEN
    RAISE EXCEPTION 'Servidor não encontrado, não pertence ao tenant ou não está arquivado.';
  END IF;

  DELETE FROM server_credit_usage   WHERE server_id = p_server_id;
  DELETE FROM server_credit_sales   WHERE server_id = p_server_id;
  DELETE FROM server_credit_purchases WHERE server_id = p_server_id;
  DELETE FROM server_events         WHERE server_id = p_server_id;
  DELETE FROM reseller_servers      WHERE server_id = p_server_id;
  DELETE FROM client_renewals       WHERE server_id = p_server_id;

  UPDATE clients SET server_id = NULL WHERE server_id = p_server_id AND tenant_id = p_tenant_id;

  DELETE FROM servers WHERE id = p_server_id AND tenant_id = p_tenant_id;
END;
$function$;

-- 10) get_last_reseller_sale
CREATE OR REPLACE FUNCTION public.get_last_reseller_sale(p_tenant_id uuid, p_reseller_server_id uuid)
 RETURNS TABLE(last_qty numeric, last_unit_price numeric, last_currency text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  RETURN QUERY
  SELECT
    credits_sold,
    unit_price,
    sale_currency::text
  FROM server_credit_sales
  WHERE tenant_id = p_tenant_id
    AND reseller_server_id = p_reseller_server_id
  ORDER BY created_at DESC
  LIMIT 1;
END;
$function$;

-- 11) resolve_notification
CREATE OR REPLACE FUNCTION public.resolve_notification(p_tenant_id uuid, p_type text, p_source_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update notifications
  set resolved_at = now()
  where tenant_id = p_tenant_id
    and type = p_type
    and source_id = p_source_id
    and resolved_at is null;
end;
$function$;

-- 12) sell_credits_to_reseller_without_balance
CREATE OR REPLACE FUNCTION public.sell_credits_to_reseller_without_balance(p_tenant_id uuid, p_server_id uuid, p_reseller_server_id uuid, p_credits_sold numeric, p_unit_price numeric, p_sale_currency currency_code, p_total_amount_brl numeric, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(sale_id uuid, logged_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_sale_id uuid;
  v_logged_at timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_credits_sold IS NULL OR p_credits_sold <= 0 THEN
    RAISE EXCEPTION 'credits_sold inválido';
  END IF;

  IF p_unit_price IS NULL OR p_unit_price <= 0 THEN
    RAISE EXCEPTION 'unit_price inválido';
  END IF;

  IF p_total_amount_brl IS NULL OR p_total_amount_brl <= 0 THEN
    RAISE EXCEPTION 'total_amount_brl inválido';
  END IF;

  INSERT INTO server_credit_sales (
    tenant_id,
    server_id,
    reseller_server_id,
    credits_sold,
    unit_price,
    sale_currency,
    total_amount_brl,
    notes
  )
  VALUES (
    p_tenant_id,
    p_server_id,
    p_reseller_server_id,
    p_credits_sold,
    p_unit_price,
    p_sale_currency,
    p_total_amount_brl,
    p_notes
  )
  RETURNING id, created_at INTO v_sale_id, v_logged_at;

  UPDATE public.reseller_servers
  SET last_recharge_credits = p_credits_sold::int
  WHERE id = p_reseller_server_id AND tenant_id = p_tenant_id;

  RETURN QUERY SELECT v_sale_id, v_logged_at;
END;
$function$;

-- 13) log_server_credit_purchase_only
CREATE OR REPLACE FUNCTION public.log_server_credit_purchase_only(p_tenant_id uuid, p_server_id uuid, p_credits_qty numeric, p_unit_price numeric, p_purchase_currency currency_code, p_total_amount_brl numeric, p_fx_rate_to_brl numeric DEFAULT 1.0, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(purchase_id uuid, logged_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_purchase_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF p_credits_qty IS NULL OR p_credits_qty <= 0 THEN
    RAISE EXCEPTION 'credits_qty inválido';
  END IF;

  IF p_unit_price IS NULL OR p_unit_price <= 0 THEN
    RAISE EXCEPTION 'unit_price inválido';
  END IF;

  IF p_total_amount_brl IS NULL OR p_total_amount_brl <= 0 THEN
    RAISE EXCEPTION 'total_amount_brl inválido';
  END IF;

  INSERT INTO server_credit_purchases (
    tenant_id,
    server_id,
    purchase_currency,
    fx_rate_to_brl,
    credits_qty,
    unit_price,
    total_amount_brl,
    notes,
    created_by
  )
  VALUES (
    p_tenant_id,
    p_server_id,
    p_purchase_currency,
    p_fx_rate_to_brl,
    p_credits_qty,
    p_unit_price,
    p_total_amount_brl,
    p_notes,
    auth.uid()
  )
  RETURNING id, created_at INTO v_purchase_id, logged_at;

  RETURN QUERY SELECT v_purchase_id, logged_at;
END;
$function$;

-- 14) topup_server_credits_and_log
CREATE OR REPLACE FUNCTION public.topup_server_credits_and_log(p_tenant_id uuid, p_server_id uuid, p_credits_qty numeric, p_unit_price numeric, p_purchase_currency currency_code, p_total_amount_brl numeric, p_fx_rate_to_brl numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(server_id uuid, credits_before numeric, credits_after numeric, avg_cost_before numeric, avg_cost_after numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_before numeric;
  v_after  numeric;
  v_avg_before numeric;
  v_avg_after  numeric;
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_credits_qty is null or p_credits_qty <= 0 then
    raise exception 'credits_qty inválido';
  end if;

  if p_unit_price is null or p_unit_price <= 0 then
    raise exception 'unit_price inválido';
  end if;

  if p_total_amount_brl is null or p_total_amount_brl <= 0 then
    raise exception 'total_amount_brl inválido';
  end if;

  select
    s.credits_available,
    s.avg_credit_cost_brl
  into
    v_before,
    v_avg_before
  from public.servers s
  where s.id = p_server_id
    and s.tenant_id = p_tenant_id
  for update;

  insert into public.server_credit_purchases (
    tenant_id,
    server_id,
    purchase_currency,
    fx_rate_to_brl,
    credits_qty,
    unit_price,
    total_amount_brl,
    notes,
    created_by
  )
  values (
    p_tenant_id,
    p_server_id,
    p_purchase_currency,
    p_fx_rate_to_brl,
    p_credits_qty,
    p_unit_price,
    p_total_amount_brl,
    p_notes,
    auth.uid()
  );

  v_after := coalesce(v_before, 0) + p_credits_qty;

  v_avg_after :=
    case
      when coalesce(v_after, 0) <= 0 then coalesce(v_avg_before, 0)
      else (
        (coalesce(v_before, 0) * coalesce(v_avg_before, 0)) + p_total_amount_brl
      ) / v_after
    end;

  update public.servers s
  set
    credits_available = v_after,
    avg_credit_cost_brl = v_avg_after
  where s.id = p_server_id
    and s.tenant_id = p_tenant_id;

  return query
  select p_server_id, v_before, v_after, v_avg_before, v_avg_after;
end;
$function$;

-- 15) delete_server_hard — já verificava auth.uid()/p_created_by, mas nunca
-- checava se o usuário de fato pertence ao tenant do servidor (só validava
-- que o servidor pertence ao p_tenant_id informado, não que o CHAMADOR
-- pertence a esse tenant). Adiciona a checagem que faltava.
CREATE OR REPLACE FUNCTION public.delete_server_hard(p_tenant_id uuid, p_server_id uuid, p_created_by uuid)
 RETURNS TABLE(deleted_server integer, deleted_clients integer, deleted_client_renewals integer, deleted_reseller_servers integer, deleted_credit_purchases integer, deleted_credit_sales integer, deleted_credit_usage integer, deleted_server_events integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_archived boolean;
  v_tenant_id uuid;
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
