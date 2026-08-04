-- Alarga a janela-gatilho de enfileiramento em billing_enqueue_scheduled
-- (docs/sql/fix_billing_lateral_random_cache.sql) de 75 SEGUNDOS pra
-- 1 HORA (3600s) — pedido do Márcio.
--
-- Motivo: com a janela de 75s, se o ÚNICO tick do cron que cai dentro dela
-- falhar por qualquer motivo (cold start, erro transitório, cron do
-- provedor atrasando), o lote de mensagens daquele dia inteiro simplesmente
-- não é gerado — sem re-tentativa nenhuma, silenciosamente, até o dia
-- seguinte. Com uma janela de 1h e o cron batendo a cada 15 minutos (fora
-- deste repo — configurado no provedor), sobra margem pra até 3 falhas
-- seguidas sem perder o disparo do dia: o 1º tick que cair dentro da janela
-- e funcionar já gera o lote.
--
-- Por que é seguro rodar a lógica de novo em cima do mesmo lote (até 4x
-- dentro da mesma janela de 1h, se o cron for de 15 em 15 min): o `ins`
-- (INSERT final) já tinha uma trava de idempotência ANTES desta mudança —
-- `where not exists (select 1 from client_message_jobs j where ... status
-- in ('SCHEDULED','QUEUED','SENDING','SENT') and mesmo dia)` — então só a
-- PRIMEIRA execução bem-sucedida dentro da janela realmente insere linhas;
-- qualquer tick seguinte que também caia dentro da janela recalcula tudo
-- de novo (client elegível, variação sorteada, delay) mas não insere nada
-- duplicado, porque pra cada (automação, cliente, dia) já existe uma linha.
-- Único efeito colateral: até 4x mais consultas pesadas rodando por dia em
-- vez de 1x — sem custo perceptível pro volume atual do tenant.
--
-- Nota sobre o horário de envio: send_at continua sendo calculado como
-- `window_start + atraso acumulado` (âncora fixa no horário configurado,
-- não no horário em que o enfileiramento de fato rodou). Isso quer dizer
-- que se o primeiro tick bem-sucedido só acontecer bem depois do
-- window_start (ex: os 2 primeiros ticks falharam e só o 3º, 30min depois,
-- funcionou), os primeiros send_at calculados (window_start + poucos
-- minutos) já vão nascer no passado — a fila de processamento (que já
-- busca `send_at <= now()`) ainda pega e envia essas mensagens
-- normalmente, só que sem o espaçamento configurado entre elas (só nesse
-- cenário de falha real, sem impacto no dia a dia normal).
--
-- Único trecho alterado: v_trigger_secs de 75 pra 3600. Resto idêntico ao
-- último CREATE OR REPLACE (fix_billing_lateral_random_cache.sql).

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
$function$;
