-- Atualiza billing_enqueue_scheduled pra sortear entre a mensagem original
-- e as variantes cadastradas em message_template_variants (uma por
-- cliente, não por lote inteiro) — pedido do Márcio (26/07/2026), parte da
-- estratégia anti-detecção de "mensagem automatizada em massa" do
-- WhatsApp. Sem variantes cadastradas, comportamento idêntico a antes.
-- Ver docs/sql/message_template_variants.sql para a tabela nova.
--
-- Testado com dry-run (LATERAL + order by random()) antes de substituir a
-- função de produção, confirmado sorteio funcionando em produção real.
CREATE OR REPLACE FUNCTION public.billing_enqueue_scheduled(p_tenant_id uuid, p_fire_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now_sp      timestamp;
  v_dow_sp      int;
  v_total       int := 0;
  v_window_secs int := 75;
  v_admin_user_id uuid;
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

  with automations as (
    select
      a.id as automation_id,
      a.tenant_id,
      a.message_template_id,
      a.whatsapp_session,
      a.delay_min,
      a.schedule_time,
      a.schedule_days,
      a.target_status,
      a.target_servers,
      a.target_plans,
      a.target_apps,
      a.rule_date_field,
      a.rule_days_diff,
      (p_fire_date::timestamp + (a.schedule_time::time)) as base_sp,
      ((p_fire_date::timestamp + (a.schedule_time::time)) at time zone 'America/Sao_Paulo') as base_utc
    from billing_automations a
    where a.tenant_id = p_tenant_id
      and a.is_active = true
      and a.is_automatic = true
      and a.schedule_time is not null
      and coalesce(a.execution_status, 'IDLE') = 'RUNNING'
  ),

  eligible_automations as (
    select *
    from automations a
    where
      (
        a.schedule_days is null
        or cardinality(a.schedule_days) = 0
        or v_dow_sp = any(a.schedule_days)
      )
      and
      (
        now() >= a.base_utc
        and now() <  a.base_utc + make_interval(secs => v_window_secs)
      )
  ),

  -- ✅ Variações de texto (pedido do Márcio, 26/07/2026) — em vez de sempre
  -- usar message_templates.content sozinho, junta o original + as
  -- variantes cadastradas em message_template_variants. Cada cliente do
  -- mesmo disparo sorteia UMA (via LATERAL abaixo), não o lote inteiro —
  -- reduz a repetição de texto idêntico, um dos sinais que o WhatsApp usa
  -- pra identificar mensagem automatizada em massa (achado real: conta
  -- restrita/dispositivo deslogado repetidamente). Sem nenhuma variante
  -- cadastrada, o comportamento é idêntico a antes (só o original).
  tpl_variants as (
    select t.id as template_id, t.content, t.image_url
    from message_templates t
    where t.tenant_id = p_tenant_id
    union all
    select v.template_id, v.content, t2.image_url
    from message_template_variants v
    join message_templates t2 on t2.id = v.template_id
    where v.tenant_id = p_tenant_id
  ),

  impacted as (
    select
      ea.automation_id,
      ea.tenant_id,
      ea.whatsapp_session,
      ea.message_template_id,
      ea.delay_min,
      ea.base_sp,
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
        when lower(coalesce(ea.rule_date_field,'')) in ('vencimento') then
          (timezone('America/Sao_Paulo', c.vencimento))::date
        when lower(coalesce(ea.rule_date_field,'')) in ('created_at','cadastro') then
          (timezone('America/Sao_Paulo', c.created_at))::date
        else
          (timezone('America/Sao_Paulo', c.created_at))::date
      end as base_date_sp
    from eligible_automations ea
    join vw_clients_list_active c
      on c.tenant_id = ea.tenant_id
    cross join lateral (
      select tv.content, tv.image_url
      from tpl_variants tv
      where tv.template_id = ea.message_template_id
      order by random()
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
  ),

  -- ✅ AJUSTADO: delay fixo por automação (sem delay_max, sem sorteio),
  -- mesma filosofia já aplicada no envio_programado
  schedule as (
    select
      f.*,
      greatest(coalesce(f.delay_min, 20), 15) as delay_secs,
      row_number() over (partition by f.automation_id order by f.username nulls last, f.client_id) as rn
    from filtered f
  ),

  schedule3 as (
    select
      s.*,
      (
        sum(s.delay_secs) over (
          partition by s.automation_id
          order by s.username nulls last, s.client_id
          rows between unbounded preceding and current row
        ) - s.delay_secs
      )::int as cum_secs
    from schedule s
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
      s3.tenant_id,
      s3.client_id,
      s3.automation_id,
      s3.message_template_id,
      s3.message_text,
      s3.message_image_url,
      'SCHEDULED',
      ((s3.base_sp + make_interval(secs => s3.cum_secs)) at time zone 'America/Sao_Paulo'),
      coalesce(s3.whatsapp_session, 'default'),
      v_admin_user_id
    from schedule3 s3
    where not exists (
      select 1
      from client_message_jobs j
      where j.tenant_id = s3.tenant_id
        and j.automation_id = s3.automation_id
        and j.client_id = s3.client_id
        and (timezone('America/Sao_Paulo', j.send_at))::date = p_fire_date
        and j.status in ('SCHEDULED','QUEUED','SENDING','SENT')
    )
    returning 1
  )
  select count(*) into v_total from ins;

  return v_total;
end;
$function$
