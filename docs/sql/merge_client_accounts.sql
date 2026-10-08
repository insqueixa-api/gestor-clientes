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
--   • tudo numa transação: ou mescla inteiro, ou nada.

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

  -- 4) apps: licença é da pessoa → vem pra principal (sem a lista M3U do
  -- servidor antigo); app idêntico ao que a principal já tem não duplica
  delete from client_apps a
   where a.client_id = p_remove
     and exists (select 1 from client_apps b where b.client_id = p_keep and b.app_id = a.app_id
                   and coalesce(b.field_values, '{}'::jsonb) - '_config_cost' - '_config_partner'
                     = coalesce(a.field_values, '{}'::jsonb) - '_config_cost' - '_config_partner');
  update client_apps set client_id = p_keep, m3u_list = null, m3u_list_at = null where client_id = p_remove;
  get diagnostics c = row_count; n := n || jsonb_build_object('apps', c);

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

revoke all on function public._merge_accounts_check(uuid, uuid, uuid) from public, anon;
revoke all on function public.merge_client_accounts_preview(uuid, uuid, uuid) from public, anon;
revoke all on function public.merge_client_accounts(uuid, uuid, uuid) from public, anon;
grant execute on function public.merge_client_accounts_preview(uuid, uuid, uuid) to authenticated;
grant execute on function public.merge_client_accounts(uuid, uuid, uuid) to authenticated;
