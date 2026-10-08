-- ✅ 08/10/2026, pedido do Márcio — "Mesclar e excluir a conta antiga".
-- Caso típico: cliente trocou de servidor (Sandra: NaTV → Fast). A conta
-- antiga já foi apagada no servidor; só ficou aqui por causa do histórico.
-- Traz TODO o histórico da antiga pra principal e exclui a antiga.
--
-- Por que é seguro pro financeiro: todo registro de histórico já guarda o
-- servidor onde aconteceu (client_renewals.server_id, server_credit_*.server_id,
-- client_portal_payments.server_* e client_events.meta.server_* — ver
-- server_snapshot_history.sql). Mudar o client_id NÃO muda o servidor de
-- nenhum registro: renovação NaTV continua NaTV.
--
-- Regras:
--   • mesmo whatsapp_username (normalizado), mesmo tenant, contas diferentes;
--   • manual, quem chama escolhe a principal (p_keep) e a antiga (p_remove);
--   • cupom usado pelas DUAS contas → bloqueia (1 uso por conta; apagar um
--     dos usos liberaria o cupom de novo);
--   • tudo numa transação: ou mescla inteiro, ou nada;
--   • NÃO chama painel/app nem mexe em lista M3U: quando o Márcio mescla, a
--     conta nova já está configurada e funcionando;
--   • plano, valor e telas: ficam os da principal (o servidor novo pode ter
--     outro preço). Da antiga, a principal só herda a data de cadastro mais
--     antiga, o histórico e os apps que ela ainda não tem (regra no passo 4).

create or replace function public._merge_accounts_check(p_tenant_id uuid, p_keep uuid, p_remove uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k record; r record;
begin
  if not exists (select 1 from tenant_members tm where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if p_keep = p_remove then
    raise exception 'Escolha duas contas diferentes.' using errcode = 'P0001';
  end if;
  select id, whatsapp_username into k from clients where id = p_keep and tenant_id = p_tenant_id;
  select id, whatsapp_username into r from clients where id = p_remove and tenant_id = p_tenant_id;
  if k.id is null or r.id is null then
    raise exception 'Conta não encontrada.' using errcode = 'P0001';
  end if;
  if coalesce(regexp_replace(k.whatsapp_username, '\D', '', 'g'), '') = ''
     or regexp_replace(k.whatsapp_username, '\D', '', 'g') <> regexp_replace(coalesce(r.whatsapp_username, ''), '\D', '', 'g') then
    raise exception 'Só dá pra mesclar contas com o mesmo WhatsApp.' using errcode = 'P0001';
  end if;
end $$;

-- App da conta antiga já existe na principal? Mesmo app + mesmo Device ID
-- (MAC, normalizado); sem MAC, pela Device Key; sem os dois, só se os
-- campos forem idênticos. Devolve o client_apps.id da principal ou null.
create or replace function public._merge_app_match(p_keep uuid, p_old_app_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a record; v_mac text; v_key text; v_val text; v_id uuid;
begin
  select ca.*, ap.fields_config into a from client_apps ca join apps ap on ap.id = ca.app_id where ca.id = p_old_app_id;
  if a.id is null then return null; end if;
  select f->>'id' into v_mac from jsonb_array_elements(coalesce(a.fields_config, '[]'::jsonb)) f where f->>'type' = 'mac' limit 1;
  select f->>'id' into v_key from jsonb_array_elements(coalesce(a.fields_config, '[]'::jsonb)) f where f->>'type' = 'device_key' limit 1;

  v_val := upper(regexp_replace(coalesce(a.field_values->>v_mac, ''), '[^0-9A-Za-z]', '', 'g'));
  if v_mac is not null and v_val <> '' then
    select b.id into v_id from client_apps b
     where b.client_id = p_keep and b.app_id = a.app_id
       and upper(regexp_replace(coalesce(b.field_values->>v_mac, ''), '[^0-9A-Za-z]', '', 'g')) = v_val
     limit 1;
    return v_id;
  end if;

  v_val := trim(coalesce(a.field_values->>v_key, ''));
  if v_key is not null and v_val <> '' then
    select b.id into v_id from client_apps b
     where b.client_id = p_keep and b.app_id = a.app_id and trim(coalesce(b.field_values->>v_key, '')) = v_val
     limit 1;
    return v_id;
  end if;

  select b.id into v_id from client_apps b
   where b.client_id = p_keep and b.app_id = a.app_id
     and coalesce(b.field_values, '{}'::jsonb) - '_config_cost' - '_config_partner'
       = coalesce(a.field_values, '{}'::jsonb) - '_config_cost' - '_config_partner'
   limit 1;
  return v_id;
end $$;

-- Prévia: o que vai ser movido (pra tela de confirmação). Não altera nada.
create or replace function public.merge_client_accounts_preview(p_tenant_id uuid, p_keep uuid, p_remove uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _merge_accounts_check(p_tenant_id, p_keep, p_remove);
  return jsonb_build_object(
    'renewals', (select count(*) from client_renewals where client_id = p_remove),
    'portal_payments', (select count(*) from client_portal_payments where client_id = p_remove),
    'events', (select count(*) from client_events where client_id = p_remove),
    'alerts', (select count(*) from client_alerts where client_id = p_remove),
    'open_alerts', (select count(*) from client_alerts where client_id = p_remove and status = 'OPEN'),
    'apps', (select count(*) from client_apps where client_id = p_remove),
    'apps_new', (select count(*) from client_apps where client_id = p_remove and _merge_app_match(p_keep, id) is null),
    'apps_existing', (select count(*) from client_apps where client_id = p_remove and _merge_app_match(p_keep, id) is not null),
    'message_jobs', (select count(*) from client_message_jobs where client_id = p_remove),
    'pending_jobs', (select count(*) from client_message_jobs where client_id = p_remove and status in ('SCHEDULED','QUEUED','PAUSED','SENDING')),
    'revenue_by_server', coalesce((
      select jsonb_object_agg(coalesce(s.name, '—'), t.total)
        from (select server_id, sum(total_amount) total from client_renewals where client_id = p_remove group by server_id) t
        left join servers s on s.id = t.server_id), '{}'::jsonb),
    'coupon_conflicts', (select count(*) from coupon_redemptions a join coupon_redemptions b
                           on b.coupon_id = a.coupon_id and b.client_id = p_keep
                         where a.client_id = p_remove)
  );
end $$;

create or replace function public.merge_client_accounts(p_tenant_id uuid, p_keep uuid, p_remove uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k record; r record;
  n jsonb := '{}'::jsonb;
  c int;
  a_row record;
  v_match uuid;
  v_apps_added int := 0;
  v_apps_merged int := 0;
begin
  perform _merge_accounts_check(p_tenant_id, p_keep, p_remove);

  -- trava as duas contas (ordem fixa por id evita deadlock)
  perform 1 from clients where id in (p_keep, p_remove) order by id for update;
  select c2.*, s.name as server_name into k from clients c2 left join servers s on s.id = c2.server_id where c2.id = p_keep;
  select c2.*, s.name as server_name into r from clients c2 left join servers s on s.id = c2.server_id where c2.id = p_remove;

  if exists (select 1 from coupon_redemptions a join coupon_redemptions b on b.coupon_id = a.coupon_id and b.client_id = p_keep
              where a.client_id = p_remove) then
    raise exception 'As duas contas usaram o mesmo cupom — mesclar liberaria o cupom de novo. Resolva o cupom antes.' using errcode = 'P0001';
  end if;

  -- 0) garante o carimbo de servidor da conta ANTIGA antes de mover
  update client_portal_payments
     set server_id = r.server_id, server_username = r.server_username, server_name = r.server_name
   where client_id = p_remove and server_id is null and r.server_id is not null;
  update client_events
     set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('server_id', r.server_id, 'server_username', r.server_username, 'server_name', r.server_name)
   where client_id = p_remove and not (coalesce(meta, '{}'::jsonb) ? 'server_id') and r.server_id is not null;
  update client_renewals set server_id = r.server_id where client_id = p_remove and server_id is null;

  -- 1) histórico: só troca o dono
  update client_renewals set client_id = p_keep where client_id = p_remove;          get diagnostics c = row_count; n := n || jsonb_build_object('renewals', c);
  update client_portal_payments set client_id = p_keep where client_id = p_remove;   get diagnostics c = row_count; n := n || jsonb_build_object('portal_payments', c);
  update client_events set client_id = p_keep where client_id = p_remove;            get diagnostics c = row_count; n := n || jsonb_build_object('events', c);
  update client_alerts set client_id = p_keep where client_id = p_remove;            get diagnostics c = row_count; n := n || jsonb_build_object('alerts', c);
  update billing_logs set client_id = p_keep where client_id = p_remove;             get diagnostics c = row_count; n := n || jsonb_build_object('billing_logs', c);
  update server_credit_usage set client_id = p_keep where client_id = p_remove;      get diagnostics c = row_count; n := n || jsonb_build_object('credit_usage', c);
  update server_credit_sales set client_id = p_keep where client_id = p_remove;      get diagnostics c = row_count; n := n || jsonb_build_object('credit_sales', c);
  update client_app_activity_log set client_id = p_keep where client_id = p_remove;
  update client_app_requests set client_id = p_keep where client_id = p_remove;
  update gpc_roku_activations set client_id = p_keep where client_id = p_remove;
  update google_contacts set client_id = p_keep where client_id = p_remove;
  update coupons set client_id = p_keep where client_id = p_remove;
  update coupon_redemptions set client_id = p_keep where client_id = p_remove;       get diagnostics c = row_count; n := n || jsonb_build_object('coupon_redemptions', c);
  update reseller_client_apps set end_client_id = p_keep where end_client_id = p_remove;

  -- 2) fila de mensagens: o que ia sair pra conta antiga é cancelado; histórico vem junto
  update client_message_jobs
     set status = 'CANCELLED', error_message = 'Conta mesclada em ' || coalesce(k.server_username, 'outra conta')
   where client_id = p_remove and status in ('SCHEDULED','QUEUED','PAUSED','SENDING');
  get diagnostics c = row_count; n := n || jsonb_build_object('jobs_cancelled', c);
  update client_message_jobs set client_id = p_keep where client_id = p_remove;     get diagnostics c = row_count; n := n || jsonb_build_object('message_jobs', c);

  -- 3) previsão mensal: mês só da antiga vem; mês que as duas têm fica o da principal
  delete from fin_previsao_snapshot a
   where a.client_id = p_remove
     and exists (select 1 from fin_previsao_snapshot b where b.client_id = p_keep and b.tenant_id = a.tenant_id and b.ano_mes = a.ano_mes);
  update fin_previsao_snapshot set client_id = p_keep where client_id = p_remove;

  -- 4) apps (regra do Márcio, 08/10/2026 — NADA de reconfigurar/apagar
  -- lista: até aqui ele já configurou a conta nova e está funcionando):
  --   • a principal já tem o app (mesmo app + Device ID) → só COMPLETA o que
  --     estiver vazio nela (vencimento, key, ambiente...); o que ela já tem
  --     fica; referências ao app antigo passam pro dela; o antigo sai;
  --   • não tem → o app vem como está (vencimento incluso).
  for a_row in select id from client_apps where client_id = p_remove loop
    v_match := _merge_app_match(p_keep, a_row.id);
    if v_match is null then
      update client_apps set client_id = p_keep where id = a_row.id;
      v_apps_added := v_apps_added + 1;
    else
      update client_apps b
         set field_values = coalesce(b.field_values, '{}'::jsonb) || coalesce((
               select jsonb_object_agg(e.key, e.value)
                 from client_apps o, jsonb_each(coalesce(o.field_values, '{}'::jsonb)) e
                where o.id = a_row.id
                  and coalesce(e.value #>> '{}', '') <> ''
                  and coalesce(b.field_values ->> e.key, '') = ''), '{}'::jsonb),
             license_paid_until = coalesce(b.license_paid_until, (select license_paid_until from client_apps where id = a_row.id)),
             device_type = coalesce(b.device_type, (select device_type from client_apps where id = a_row.id))
       where b.id = v_match;
      update client_alerts set client_app_id = v_match where client_app_id = a_row.id;
      update client_portal_payments set client_app_id = v_match where client_app_id = a_row.id;
      update client_app_requests set client_app_id = v_match where client_app_id = a_row.id;
      update client_app_activity_log set client_app_id = v_match where client_app_id = a_row.id;
      update gpc_roku_activations set client_app_id = v_match where client_app_id = a_row.id;
      delete from client_apps where id = a_row.id;
      v_apps_merged := v_apps_merged + 1;
    end if;
  end loop;
  n := n || jsonb_build_object('apps_added', v_apps_added, 'apps_already_there', v_apps_merged);

  -- 5) operacionais da antiga: somem com ela (travas de disparo e guarda anti-abuso)
  delete from billing_dispatch_locks where client_id = p_remove;
  delete from coupon_abuse_guard where client_id = p_remove;

  -- 6) principal herda a data de cadastro mais antiga
  update clients set created_at = least(created_at, r.created_at), updated_at = now() where id = p_keep;

  -- 7) registro na Linha do Tempo da principal
  insert into client_events (tenant_id, client_id, event_type, message, meta)
  values (p_tenant_id, p_keep, 'ACCOUNTS_MERGED',
          'Conta ' || coalesce(r.server_username, '—') || ' (' || coalesce(r.server_name, 'sem servidor') || ') mesclada nesta conta e excluída',
          n || jsonb_build_object('removed_client_id', p_remove, 'removed_server_id', r.server_id,
                                  'removed_server_name', r.server_name, 'removed_server_username', r.server_username,
                                  'removed_created_at', r.created_at));

  -- 8) exclui a antiga (o que sobrou — contatos — sai em cascata)
  delete from clients where id = p_remove and tenant_id = p_tenant_id;

  return n;
end $$;

revoke all on function public._merge_accounts_check(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._merge_app_match(uuid, uuid) from public, anon, authenticated;
revoke all on function public.merge_client_accounts_preview(uuid, uuid, uuid) from public, anon;
revoke all on function public.merge_client_accounts(uuid, uuid, uuid) from public, anon;
grant execute on function public.merge_client_accounts_preview(uuid, uuid, uuid) to authenticated;
grant execute on function public.merge_client_accounts(uuid, uuid, uuid) to authenticated;
