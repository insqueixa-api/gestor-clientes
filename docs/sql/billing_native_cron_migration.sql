-- 29/08/2026: substitui o cron-job.org externo (que batia em /envio_programado
-- de tempos em tempos entre ~9h-12h) por 2 pg_cron nativos do Supabase,
-- desenhados pra não gastar Vercel à toa quando não há nada pra fazer.
--
-- Cron 1 (enfileirador) — roda em SQL puro dentro do Postgres, NUNCA toca a
-- Vercel: chama billing_enqueue_scheduled() direto pra cada tenant com
-- automação RUNNING. Horários: 6h, 7h (rede de segurança caso o de 6h falhe
-- por algum motivo transiente) e 12h (recolhe qualquer cliente que ficou
-- elegível depois do 6h — automação ligada tarde, etc). Times em UTC no
-- cron.schedule (SP = UTC-3, sem horário de verão): 9h,10h,15h UTC.
--
-- Cron 2 (despachante) — de 2 em 2min, só entre 8h-20h SP (11h-22h UTC,
-- pedido explícito do Márcio: nunca enviar de madrugada) — mas só chama a
-- Vercel (via net.http_post) se EXISTIR algum job pronto pra enviar agora.
-- Tick vazio = 1 SELECT EXISTS barato no Postgres, zero custo na Vercel.
--
-- ============================================================
-- 1) billing_enqueue_scheduled — remove a trava de "só roda dentro de 1h do
--    horário sorteado". Antes, se nenhum tick do cron externo caísse
--    exatamente nessa janela de 1h (cron atrasado, automação virou RUNNING
--    depois que a janela fechou), o tenant ficava SEM NENHUM envio
--    automático o dia inteiro — o horário-âncora (v_window_start_sp) já é
--    calculado de forma determinística por (tenant, dia), não depende de
--    "agora", então chamar a função de manhã cedo (6h) já calcula e agenda
--    os send_at corretos pra frente (ex: 09:14, 09:19...) mesmo antes desse
--    horário chegar. A lógica de continuar a corrente entre chamadas
--    (v_anchor_sp = maior entre a âncora e o último job já enfileirado hoje)
--    já existia e não muda — é o que permite rodar 3x/dia sem duplicar nem
--    resetar o embaralhamento.
-- ============================================================
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

  -- Config única da campanha (início + intervalo), substitui o
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

  -- Sorteio do horário-âncora do dia dentro de [window_start_min,
  -- window_start_max] — determinístico por (tenant, dia) via hashtext(),
  -- pra toda chamada (cron 6h/7h/12h ou botão manual) calcular o MESMO
  -- horário. abs(...) porque hashtext devolve int4 (pode ser negativo).
  v_range_secs := greatest(
    extract(epoch from (v_settings.window_start_max - v_settings.window_start_min))::int,
    0
  );
  v_offset_secs := case
    when v_range_secs > 0 then (abs(hashtext(p_tenant_id::text || '|' || p_fire_date::text)::bigint) % v_range_secs)::int
    else 0
  end;

  v_window_start_sp := p_fire_date::timestamp + v_settings.window_start_min + make_interval(secs => v_offset_secs);
  -- ✅ 29/08/2026: removida a trava "só roda dentro de 1h do horário
  -- sorteado" — v_window_start_sp já é a âncora certa mesmo calculada horas
  -- antes dela chegar; quem decide QUANDO cada mensagem sai de verdade é o
  -- send_at gravado abaixo, não o horário desta chamada.

  -- Âncora: se já existe alguma mensagem agendada hoje pro tenant (de uma
  -- chamada anterior no mesmo dia), o próximo lote continua a partir dali —
  -- nunca reinicia no horário-âncora sorteado.
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

-- ============================================================
-- 2) billing_enqueue_all_tenants — wrapper que o Cron 1 chama: percorre
--    todos os tenants com pelo menos 1 automação RUNNING e enfileira cada
--    um. p_fire_date default = hoje em SP (dá pra passar outra data na mão
--    se precisar reprocessar um dia específico).
-- ============================================================
CREATE OR REPLACE FUNCTION public.billing_enqueue_all_tenants(p_fire_date date DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fire_date date := coalesce(p_fire_date, (now() at time zone 'America/Sao_Paulo')::date);
  v_tenant record;
  v_total int := 0;
begin
  for v_tenant in
    select distinct tenant_id
    from billing_automations
    where is_active = true
      and is_automatic = true
      and coalesce(execution_status, 'IDLE') = 'RUNNING'
  loop
    v_total := v_total + coalesce(public.billing_enqueue_scheduled(v_tenant.tenant_id, v_fire_date), 0);
  end loop;
  return v_total;
end;
$function$;

REVOKE ALL ON FUNCTION public.billing_enqueue_all_tenants(date) FROM public;
GRANT EXECUTE ON FUNCTION public.billing_enqueue_all_tenants(date) TO service_role;

-- ============================================================
-- 3) billing_dispatch_check — Cron 2: 1 SELECT EXISTS barato; só chama a
--    Vercel (net.http_post pro /envio_programado real, mesma rota de
--    sempre) quando existe job pronto pra enviar agora. Fora disso, tick
--    "vazio" nunca sai do Postgres — zero invocação na Vercel.
-- ============================================================
CREATE OR REPLACE FUNCTION public.billing_dispatch_check()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_due boolean;
  v_secret text;
begin
  select exists (
    select 1 from client_message_jobs
    where status in ('QUEUED','SCHEDULED')
      and send_at <= now()
  ) into v_due;

  if not v_due then
    return;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'billing_cron_secret';

  if v_secret is null then
    raise warning '[billing_dispatch_check] billing_cron_secret ausente no Vault';
    return;
  end if;

  perform net.http_post(
    url := 'https://unigestor.net.br/api/whatsapp/envio_programado',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$function$;

-- ============================================================
-- 4) Secret no Vault (mesmo padrão de epg_cron_secret/cron_control_secret —
--    ver docs/sql/epg_cron_secret_vault.sql). Se rotacionar CRON_SECRET no
--    futuro, atualizar aqui também:
--      select vault.update_secret(
--        (select id from vault.decrypted_secrets where name = 'billing_cron_secret'),
--        'NOVO_TOKEN_AQUI'
--      );
-- ============================================================
select vault.create_secret(
  'UniGestor_CRON_2026_Secreta_#X9zL@Tk',
  'billing_cron_secret',
  'CRON_SECRET (envio_programado) — usado por billing_dispatch_check via net.http_post.'
);

-- ============================================================
-- 5) requeue_message_jobs — a "escadinha" de 10-30s era um valor fixo
--    hardcoded, diferente da faixa configurada em billing_campaign_settings
--    (delay_min_secs/delay_max_secs, a mesma faixa "Intervalo mín/máx" da
--    tela). Pedido do Márcio, 29/08/2026: reenvio manual deve obedecer a
--    MESMA faixa do enfileirador automático, não um valor à parte.
-- ============================================================
create or replace function public.requeue_message_jobs(p_tenant_id uuid, p_ids uuid[])
returns table(job_id uuid, action text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
  v_today date := (timezone('America/Sao_Paulo', v_now))::date;
  r record;
  v_current_send_at timestamptz := v_now;
  v_delay int;
  v_delay_min int;
  v_delay_max int;
  v_dup_exists boolean;
  v_new_id uuid;
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select delay_min_secs, delay_max_secs into v_delay_min, v_delay_max
  from public.billing_campaign_settings
  where tenant_id = p_tenant_id;

  v_delay_min := coalesce(v_delay_min, 180);
  v_delay_max := coalesce(v_delay_max, 420);
  if v_delay_max < v_delay_min then
    v_delay_max := v_delay_min;
  end if;

  for r in
    select j.id, j.client_id, j.reseller_id, j.message, j.image_url, j.message_template_id,
           j.whatsapp_session, j.automation_id
    from public.client_message_jobs j
    where j.tenant_id = p_tenant_id and j.id = any(p_ids)
    order by j.send_at asc
  loop
    v_dup_exists := exists (
      select 1
      from public.client_message_jobs j2
      where j2.tenant_id = p_tenant_id
        and j2.client_id = r.client_id
        and j2.message_template_id = r.message_template_id
        and j2.id <> r.id
        and (timezone('America/Sao_Paulo', j2.send_at))::date = v_today
        and j2.status in ('SCHEDULED', 'QUEUED', 'SENDING', 'SENT')
    );

    if v_dup_exists then
      update public.client_message_jobs
      set status = 'CANCELLED',
          error_message = 'Não reenviado — cliente já tem outro envio deste template hoje.'
      where id = r.id;

      job_id := r.id;
      action := 'skipped_duplicate';
      return next;
    else
      -- Espaçamento entre reenvios = MESMA faixa configurada na campanha
      -- (delay_min_secs/delay_max_secs), não mais um valor fixo à parte.
      v_delay := v_delay_min + floor(random() * greatest(v_delay_max - v_delay_min + 1, 1));
      v_current_send_at := v_current_send_at + make_interval(secs => v_delay);

      insert into public.client_message_jobs (
        tenant_id, message, image_url, message_template_id, automation_id,
        whatsapp_session, status, send_at, client_id, reseller_id
      ) values (
        p_tenant_id, r.message, r.image_url, r.message_template_id, r.automation_id,
        coalesce(r.whatsapp_session, 'default'), 'SCHEDULED', v_current_send_at,
        case when r.reseller_id is null then r.client_id else null end,
        r.reseller_id
      )
      returning id into v_new_id;

      update public.client_message_jobs
      set status = 'CANCELLED', error_message = 'Reenfileirado manualmente via Logs'
      where id = r.id;

      job_id := v_new_id;
      action := 'requeued';
      return next;
    end if;
  end loop;
end;
$function$;

revoke all on function public.requeue_message_jobs(uuid, uuid[]) from public;
grant execute on function public.requeue_message_jobs(uuid, uuid[]) to authenticated;

-- ============================================================
-- 6) Os 2 novos pg_cron. cron.schedule faz upsert por nome (seguro rodar de
--    novo). Horários em UTC (SP = UTC-3, sem DST): 6h/7h/12h SP =
--    9h/10h/15h UTC; janela 8h-20h SP = 11h-22h UTC.
-- ============================================================
select cron.schedule(
  'billing_enqueue_daily',
  '0 9,10,15 * * *',
  $$select public.billing_enqueue_all_tenants();$$
);

select cron.schedule(
  'billing_dispatch_check',
  '*/2 11-22 * * *',
  $$select public.billing_dispatch_check();$$
);

-- Conferir depois de rodar:
--   select jobname, schedule, active from cron.job where jobname in ('billing_enqueue_daily','billing_dispatch_check');
--   select name from vault.decrypted_secrets where name = 'billing_cron_secret';
