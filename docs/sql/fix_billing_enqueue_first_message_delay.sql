-- ✅ 02/09/2026, bug real achado (pedido do Márcio: "as mensagens estão
-- saindo bem tarde" — desconfiança antiga, confirmada hoje comparando a
-- janela configurada 09:10-09:30 com a fila real começando às 09:35:35).
--
-- O CTE `cum` somava o delay sorteado da PRÓPRIA linha (janela "rows
-- between unbounded preceding and CURRENT row", inclusiva) — isso empurra
-- TODA mensagem (não só a primeira) pra depois do seu próprio atraso
-- sorteado (180-360s), em vez de depois do atraso das mensagens
-- ANTERIORES. Resultado: a 1ª mensagem do dia nunca saía no horário
-- sorteado (09:10-09:30) de verdade — sempre 3-6min depois, por acaso
-- parecendo "só um pouco atrasado" mas na real todo o dia inteiro vinha
-- deslocado por esse valor extra.
--
-- Fix: subtrai o delay_secs da própria linha da soma cumulativa inclusiva
-- — vira a soma dos atrasos de todas as linhas ANTERIORES (exclusiva).
-- 1ª linha passa a ter cum_secs=0 (sai exatamente na âncora sorteada), o
-- espaçamento entre as seguintes continua igual (180-360s cada).
CREATE OR REPLACE FUNCTION public.billing_enqueue_scheduled(p_tenant_id uuid, p_fire_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now_sp           timestamp;
  v_dow_sp           int;
  v_total            int := 0;
  v_admin_user_id    uuid;
  v_settings         record;
  v_range_secs       int;
  v_offset_secs      int;
  v_window_start_sp  timestamp;
  v_last_send_at_utc timestamptz;
  v_anchor_sp        timestamp;
begin
  v_now_sp := (now() at time zone 'America/Sao_Paulo');
  v_dow_sp := extract(dow from v_now_sp)::int;

  SELECT user_id INTO v_admin_user_id
  FROM tenant_members
  WHERE tenant_id = p_tenant_id
    AND role = 'ADMIN'
  LIMIT 1;

  IF v_admin_user_id IS NULL THEN
    SELECT user_id INTO v_admin_user_id
    FROM tenant_members
    WHERE tenant_id = p_tenant_id
    LIMIT 1;
  END IF;

  SELECT * INTO v_settings
  FROM billing_campaign_settings
  WHERE tenant_id = p_tenant_id;

  IF NOT FOUND OR NOT v_settings.is_active THEN
    RETURN 0;
  END IF;

  IF NOT (
    v_settings.schedule_days IS NULL
    OR cardinality(v_settings.schedule_days) = 0
    OR v_dow_sp = any(v_settings.schedule_days)
  ) THEN
    RETURN 0;
  END IF;

  v_range_secs := greatest(
    extract(epoch from (v_settings.window_start_max - v_settings.window_start_min))::int,
    0
  );
  v_offset_secs := case
    when v_range_secs > 0 then (abs(hashtext(p_tenant_id::text || '|' || p_fire_date::text)::bigint) % v_range_secs)::int
    else 0
  end;

  v_window_start_sp := p_fire_date::timestamp + v_settings.window_start_min + make_interval(secs => v_offset_secs);
  -- 29/08/2026: removida a trava "so roda dentro de 1h do horario sorteado"
  -- (ver docs/sql/billing_native_cron_migration.sql) -- v_window_start_sp ja
  -- e a ancora certa mesmo calculada horas antes dela chegar; quem decide
  -- QUANDO cada mensagem sai e o send_at gravado abaixo, nao o horario desta
  -- chamada.

  SELECT max(j.send_at) INTO v_last_send_at_utc
  FROM client_message_jobs j
  WHERE j.tenant_id = p_tenant_id
    AND (timezone('America/Sao_Paulo', j.send_at))::date = p_fire_date
    AND j.status in ('SCHEDULED','QUEUED','SENDING','SENT');

  v_anchor_sp := greatest(
    v_window_start_sp,
    coalesce((v_last_send_at_utc at time zone 'America/Sao_Paulo'), v_window_start_sp)
  );

  with automations as (
    select
      a.id as automation_id,
      a.tenant_id,
      a.message_template_id,
      coalesce(a.whatsapp_session, 'default') as whatsapp_session,
      a.target_status,
      a.target_servers,
      a.target_plans,
      a.target_apps,
      a.rule_date_field,
      a.rule_days_diff
    from billing_automations a
    where a.tenant_id = p_tenant_id
      and a.is_active = true
      and a.is_automatic = true
      and coalesce(a.execution_status, 'IDLE') = 'RUNNING'
  ),

  tpl_variants as (
    select t.id as template_id, t.content, t.image_url
    from message_templates t
    where t.tenant_id = p_tenant_id
    union all
    select v.template_id, v.content, t2.image_url
    from message_template_variants v
    join message_templates t2 on t2.id = v.template_id
    where v.tenant_id = p_tenant_id
      and trim(coalesce(v.content, '')) <> ''
  ),

  impacted as (
    select
      a.automation_id,
      a.tenant_id,
      a.whatsapp_session,
      a.message_template_id,
      picked.content as message_text,
      picked.image_url as message_image_url,
      c.id as client_id,
      c.username,
      c.computed_status,
      c.server_id,
      c.plan_name,
      c.apps_names,
      c.vencimento,
      c.created_at,
      case
        when lower(coalesce(a.rule_date_field,'')) in ('vencimento') then
          (timezone('America/Sao_Paulo', c.vencimento))::date
        when lower(coalesce(a.rule_date_field,'')) in ('created_at','cadastro') then
          (timezone('America/Sao_Paulo', c.created_at))::date
        else
          (timezone('America/Sao_Paulo', c.created_at))::date
      end as base_date_sp
    from automations a
    join vw_clients_list_active c
      on c.tenant_id = a.tenant_id
    cross join lateral (
      select tv.content, tv.image_url
      from tpl_variants tv
      where tv.template_id = a.message_template_id
      order by md5(c.id::text || random()::text)
      limit 1
    ) picked
  ),

  filtered as (
    select *
    from impacted x
    where
      (
        cardinality(coalesce((select target_status from billing_automations where id = x.automation_id), '{}'::text[])) = 0
        or x.computed_status::text = any(coalesce((select target_status from billing_automations where id = x.automation_id), '{}'::text[]))
      )
      and (
        cardinality(coalesce((select target_servers from billing_automations where id = x.automation_id), '{}'::text[])) = 0
        or x.server_id::text = any(coalesce((select target_servers from billing_automations where id = x.automation_id), '{}'::text[]))
      )
      and (
        cardinality(coalesce((select target_plans from billing_automations where id = x.automation_id), '{}'::text[])) = 0
        or x.plan_name::text = any(coalesce((select target_plans from billing_automations where id = x.automation_id), '{}'::text[]))
      )
      and (
        cardinality(coalesce((select target_apps from billing_automations where id = x.automation_id), '{}'::text[])) = 0
        or exists (
          select 1
          from unnest(coalesce(x.apps_names, '{}'::text[])) ca(app)
          where ca.app = any(coalesce((select target_apps from billing_automations where id = x.automation_id), '{}'::text[]))
        )
      )
      and (
        x.base_date_sp + (select rule_days_diff from billing_automations where id = x.automation_id)
      ) = p_fire_date
      and not exists (
        select 1
        from client_message_jobs j
        where j.tenant_id = x.tenant_id
          and j.automation_id = x.automation_id
          and j.client_id = x.client_id
          and (timezone('America/Sao_Paulo', j.send_at))::date = p_fire_date
          and j.status in ('SCHEDULED','QUEUED','SENDING','SENT')
      )
  ),

  shuffled as (
    select f.*, row_number() over (order by random()) as rn
    from filtered f
  ),

  staged as (
    select
      s.*,
      (
        v_settings.delay_min_secs
        + floor(random() * greatest(v_settings.delay_max_secs - v_settings.delay_min_secs + 1, 1))
      )::int as delay_secs
    from shuffled s
  ),

  cum as (
    select
      st.*,
      -- ✅ FIX 02/09/2026: exclusiva (soma dos ANTERIORES, sem a própria
      -- linha) -- era inclusiva, empurrando toda mensagem +180-360s.
      (
        sum(st.delay_secs) over (order by st.rn rows between unbounded preceding and current row)
        - st.delay_secs
      )::int as cum_secs
    from staged st
  ),

  ins as (
    insert into client_message_jobs (
      tenant_id,
      client_id,
      automation_id,
      message_template_id,
      message,
      image_url,
      status,
      send_at,
      whatsapp_session,
      created_by
    )
    select
      c.tenant_id,
      c.client_id,
      c.automation_id,
      c.message_template_id,
      c.message_text,
      c.message_image_url,
      'SCHEDULED',
      ((v_anchor_sp + make_interval(secs => c.cum_secs)) at time zone 'America/Sao_Paulo'),
      coalesce(c.whatsapp_session, 'default'),
      v_admin_user_id
    from cum c
    where not exists (
      select 1
      from client_message_jobs j
      where j.tenant_id = c.tenant_id
        and j.automation_id = c.automation_id
        and j.client_id = c.client_id
        and (timezone('America/Sao_Paulo', j.send_at))::date = p_fire_date
        and j.status in ('SCHEDULED','QUEUED','SENDING','SENT')
    )
    returning 1
  )
  select count(*) into v_total from ins;

  return v_total;
end;
$function$;
