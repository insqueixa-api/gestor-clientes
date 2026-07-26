-- Segunda rodada da estratégia anti-detecção de disparo automatizado
-- (pedido do Márcio, 26/07/2026) — depois das variações de texto (ver
-- docs/sql/billing_enqueue_scheduled_variants.sql), agora o HORÁRIO de
-- disparo também deixa de ser robótico: em vez de cada uma das
-- billing_automations disparar num schedule_time fixo próprio (09:40,
-- 09:50, 10:00...), TODAS passam a disparar a partir de um único horário
-- de início compartilhado (billing_campaign_settings.window_start),
-- embaralhadas entre si (cross-automação, não só dentro da mesma regra),
-- com intervalo aleatório entre delay_min_secs/delay_max_secs entre cada
-- mensagem.
--
-- billing_automations.schedule_time/schedule_days/delay_min NÃO são mais
-- lidos aqui — a automação passa a valer só como REGRA (público-alvo +
-- template). O gatilho de "rodar hoje" e o horário de cada envio agora
-- vêm inteiramente de billing_campaign_settings.
--
-- Continua rodando 1x por dia: só processa dentro da janela-gatilho de 75s
-- logo em window_start (mesmo mecanismo de antes, só que agora um único
-- horário-gatilho compartilhado em vez de um por automação).
--
-- ✅ SEM corte de horário final e SEM compressão — decisão explícita do
-- Márcio: se o volume do dia não couber antes do cron desacelerar (ele
-- roda de 1 em 1 min só até certo horário, depois de 10 em 10 min, por
-- config externa), a fila só continua e vai sendo drenada nos próximos
-- ticks. client_message_jobs não expira, nada se perde.
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
  v_trigger_secs     int := 75;
  v_admin_user_id    uuid;
  v_settings         record;
  v_window_start_sp  timestamp;
  v_window_start_utc timestamptz;
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

  -- ✅ Config única da campanha (início + intervalo), substitui o
  -- schedule_time/delay_min por automação.
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

  v_window_start_sp  := p_fire_date::timestamp + v_settings.window_start;
  v_window_start_utc := (v_window_start_sp at time zone 'America/Sao_Paulo');

  -- ✅ Só processa 1x por dia: só dentro da janela-gatilho de 75s logo no
  -- início de window_start (mesmo mecanismo de antes, agora com um único
  -- horário-gatilho compartilhado).
  IF NOT (now() >= v_window_start_utc AND now() < v_window_start_utc + make_interval(secs => v_trigger_secs)) THEN
    RETURN 0;
  END IF;

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

  -- ✅ Embaralha TODOS os elegíveis das N regras juntos (cross-automação) —
  -- é o "job pai" consolidando os filhos, só que via ORDER BY random() em
  -- vez de uma hierarquia de tabelas.
  shuffled as (
    select f.*, row_number() over (order by random()) as rn
    from filtered f
  ),

  -- ✅ Delay aleatório (segundos) entre o mínimo e o máximo configurados na
  -- campanha, por MENSAGEM — intervalo único do grupo, não mais por
  -- automação. Sem teto: a soma cumulativa cresce livremente a partir de
  -- window_start.
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
      ((v_window_start_sp + make_interval(secs => c.cum_secs)) at time zone 'America/Sao_Paulo'),
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
$function$
