-- 1) Novos campos de intervalo pro contato secundário (0-2min por padrão) —
--    pedido do Márcio, 05/08/2026: quando a conta tem WhatsApp
--    principal+secundário cadastrados, o segundo envio deve esperar um
--    tempo ALEATÓRIO (não fixo) depois do primeiro, pra não "ficar em
--    cima". Antes era hardcoded: 5s em app/api/whatsapp/envio_agora e 10s
--    em app/api/whatsapp/envio_programado — nenhum dos dois lia daqui.
alter table public.billing_campaign_settings
  add column if not exists secondary_contact_delay_min_secs int not null default 0,
  add column if not exists secondary_contact_delay_max_secs int not null default 120;

-- 2) Corrige billing_enqueue_scheduled (docs/sql/fix_billing_enqueue_trigger_window.sql):
--    a janela-gatilho de 1h (pra sobreviver a retries do cron) faz a função
--    rodar várias vezes no mesmo dia. Cada execução recalculava o "primeiro
--    da fila" com cum_secs=0 → send_at = window_start EXATO, mesmo que já
--    existissem mensagens agendadas mais cedo naquele dia por uma execução
--    anterior bem-sucedida.
--
--    Caso real que expôs isso: dois clientes de automações diferentes
--    (FastTV/Robson e NaTV/Laressa), elegíveis em ticks diferentes dentro
--    da mesma janela de 1h, ambos caíram com send_at = 09:30:00 — zero
--    espaçamento entre eles, exatamente o padrão que a janela existe pra
--    evitar (risco de bloqueio do número).
--
--    Fix: ancora em GREATEST(window_start, último send_at já agendado hoje
--    pro tenant) em vez de sempre em window_start. E o prefixo-soma de
--    cum_secs deixa de ser exclusivo (0 no primeiro item) — passa a incluir
--    o próprio delay, então todo item (inclusive o primeiro de qualquer
--    tick, não só o da execução inicial do dia) fica pelo menos
--    delay_min_secs depois da âncora.
--
--    Efeito colateral aceito: a primeira mensagem do dia agora sai
--    window_start + (delay_min..delay_max), não mais em window_start
--    cravado — mudança pequena e no sentido certo (mais espaçado, não
--    menos).
--
--    Também: a checagem de idempotência (`not exists ... client_message_jobs`)
--    foi pra dentro do CTE `filtered`, antes do shuffle — clientes que já
--    têm job hoje não ocupam mais posição/orçamento de delay no cálculo, e
--    o espaçamento de quem é novo neste tick fica justo (sem "buracos" por
--    clientes fantasmas já enviados em tick anterior). O `not exists` no
--    INSERT final continua — defesa extra contra corrida entre invocações
--    concorrentes do cron.
--
--    Resto idêntico ao último CREATE OR REPLACE (fix_billing_enqueue_trigger_window.sql).
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
  v_trigger_secs     int := 3600;
  v_admin_user_id    uuid;
  v_settings         record;
  v_window_start_sp  timestamp;
  v_window_start_utc timestamptz;
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

  -- ✅ Só processa 1x por dia: agora com 1h de tolerância a partir de
  -- window_start (era 75s) — dá margem pra até 3 ticks de cron falharem
  -- (a cada 15min) sem perder o disparo do dia. A trava de idempotência do
  -- INSERT (ver comentário no topo do arquivo) garante que só a primeira
  -- execução bem-sucedida dentro da janela realmente cria as linhas.
  IF NOT (now() >= v_window_start_utc AND now() < v_window_start_utc + make_interval(secs => v_trigger_secs)) THEN
    RETURN 0;
  END IF;

  -- ✅ Âncora: se já existe alguma mensagem agendada hoje pro tenant (de um
  -- tick anterior dentro da mesma janela de 1h), o próximo lote continua a
  -- partir dali — nunca reinicia em window_start.
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
      -- md5(c.id::text || random()::text) em vez de só random() — evita o
      -- cache indevido do LATERAL do Postgres quando o parâmetro
      -- correlacionado (message_template_id) não muda entre linhas de
      -- cliente da mesma automação (ver fix_billing_lateral_random_cache.sql).
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
      -- ✅ Movido pra cá (era só no INSERT): quem já tem job hoje não entra
      -- no shuffle nem consome orçamento de delay — o espaçamento de quem é
      -- novo neste tick fica justo, sem "buraco" por causa de gente que já
      -- foi (ou vai ser) enviada por um tick anterior.
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

  -- ✅ Embaralha TODOS os elegíveis das N regras juntos (cross-automação) —
  -- é o "job pai" consolidando os filhos, só que via ORDER BY random() em
  -- vez de uma hierarquia de tabelas.
  shuffled as (
    select f.*, row_number() over (order by random()) as rn
    from filtered f
  ),

  -- ✅ Delay aleatório (segundos) entre o mínimo e o máximo configurados na
  -- campanha, por MENSAGEM — intervalo único do grupo, não mais por
  -- automação. Sem teto: a soma cumulativa cresce livremente a partir da
  -- âncora.
  staged as (
    select
      s.*,
      (
        v_settings.delay_min_secs
        + floor(random() * greatest(v_settings.delay_max_secs - v_settings.delay_min_secs + 1, 1))
      )::int as delay_secs
    from shuffled s
  ),

  -- ✅ Soma-prefixo INCLUSIVA (era exclusiva, com "- delay_secs" no final,
  -- que zerava o primeiro item) — todo item fica pelo menos delay_min_secs
  -- depois da âncora, inclusive o primeiro de cada tick.
  cum as (
    select
      st.*,
      (
        sum(st.delay_secs) over (order by st.rn rows between unbounded preceding and current row)
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
