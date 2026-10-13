-- ✅ 13/10/2026, pedido do Márcio: histórico dos aplicativos da REVENDA
-- (igual ao client_app_activity_log do cliente). Antes a linha do tempo da
-- revenda montava "adicionado/configurado" a partir do próprio app
-- (reseller_client_apps) — não dava pra apagar sem apagar o app, e app
-- removido sumia. Agora cada ação do Portal da Revenda vira um registro
-- (lib/reseller-portal/apps.ts → logResellerAppActivity) e a lixeira da
-- linha do tempo apaga só o registro.

create table if not exists public.reseller_app_activity_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  reseller_client_app_id uuid null,
  app_name text not null,
  event text not null, -- added | configured | fields_updated | check_validity | renewed | removed (+ _failed)
  detail jsonb null,   -- device (campos com nomes do cadastro), cliente, servidor, lista, vencimento, license
  created_at timestamptz not null default now()
);

create index if not exists reseller_app_activity_log_reseller_idx
  on public.reseller_app_activity_log (reseller_id, created_at desc);

alter table public.reseller_app_activity_log enable row level security;

drop policy if exists admin_select_own_tenant on public.reseller_app_activity_log;
create policy admin_select_own_tenant on public.reseller_app_activity_log
  for select to authenticated
  using (exists (select 1 from public.tenant_members tm
                  where tm.user_id = auth.uid() and tm.tenant_id = reseller_app_activity_log.tenant_id));

drop policy if exists admin_delete_own_tenant on public.reseller_app_activity_log;
create policy admin_delete_own_tenant on public.reseller_app_activity_log
  for delete to authenticated
  using (exists (select 1 from public.tenant_members tm
                  where tm.user_id = auth.uid() and tm.tenant_id = reseller_app_activity_log.tenant_id));

drop policy if exists service_role_all on public.reseller_app_activity_log;
create policy service_role_all on public.reseller_app_activity_log
  for all to service_role using (true) with check (true);

revoke all on public.reseller_app_activity_log from anon;

-- Registros iniciais a partir dos apps que já existem (só se ainda não tiver
-- nenhum registro desse app): "adicionado" e, se configurou depois, "configurado".
insert into public.reseller_app_activity_log (tenant_id, reseller_id, reseller_client_app_id, app_name, event, detail, created_at)
select rca.tenant_id, rca.reseller_id, rca.id, a.name, 'added',
       jsonb_build_object('client', coalesce(ec.username, rca.m3u_username, rca.client_label), 'server', s.name),
       rca.created_at
  from public.reseller_client_apps rca
  join public.apps a on a.id = rca.app_id
  left join public.reseller_end_clients ec on ec.id = rca.end_client_id
  left join public.servers s on s.id = rca.server_id
 where not exists (select 1 from public.reseller_app_activity_log l where l.reseller_client_app_id = rca.id);

insert into public.reseller_app_activity_log (tenant_id, reseller_id, reseller_client_app_id, app_name, event, detail, created_at)
select rca.tenant_id, rca.reseller_id, rca.id, a.name, 'configured',
       jsonb_build_object('client', coalesce(ec.username, rca.m3u_username, rca.client_label), 'server', s.name,
                          'list_name', rca.list_name, 'expireDate', rca.expire_date),
       rca.configured_at
  from public.reseller_client_apps rca
  join public.apps a on a.id = rca.app_id
  left join public.reseller_end_clients ec on ec.id = rca.end_client_id
  left join public.servers s on s.id = rca.server_id
 where rca.configured_at is not null
   and not exists (select 1 from public.reseller_app_activity_log l where l.reseller_client_app_id = rca.id and l.event = 'configured');
