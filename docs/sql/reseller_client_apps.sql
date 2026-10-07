-- docs/sql/reseller_client_apps.sql
-- 07/10/2026 — Portal da Revenda: aplicativos dos clientes DA REVENDA
-- (docs/revenda-portal/PLANO.md, fase 2/3). Cada linha = 1 aparelho de um
-- cliente da revenda: app do catálogo + campos (MAC/Device Key…) + o link M3U
-- que a própria revenda informa. Separado de clients/client_apps de propósito
-- (não entra em lista de clientes, cobrança, dashboards, Papa Testes).
-- Nome da lista no aparelho: <usuario do M3U>_<Servidor> (mesma convenção dos
-- clientes do sistema; nunca apaga outra lista — exact_only).
create table if not exists public.reseller_client_apps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  client_label text not null,              -- nome do cliente da revenda
  app_id uuid not null references public.apps(id) on delete restrict,
  device_type text,
  field_values jsonb not null default '{}'::jsonb,
  m3u_url text not null,
  m3u_username text,                       -- extraído do link (username=)
  server_id uuid references public.servers(id) on delete set null,
  list_name text,                          -- <usuario>_<Servidor> enviado ao parceiro
  configured_at timestamptz,
  license_paid_until date,                 -- licença paga pela revenda (etapa B)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reseller_client_apps_reseller on public.reseller_client_apps (reseller_id, created_at desc);

alter table public.reseller_client_apps enable row level security;

drop policy if exists rca_select_by_tenant on public.reseller_client_apps;
create policy rca_select_by_tenant on public.reseller_client_apps
  for select to authenticated
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = reseller_client_apps.tenant_id
      and tm.user_id = (select auth.uid())
  ));

revoke all on public.reseller_client_apps from anon;
revoke insert, update, delete on public.reseller_client_apps from authenticated;
grant select on public.reseller_client_apps to authenticated;
grant all on public.reseller_client_apps to service_role;

drop trigger if exists trg_reseller_client_apps_updated_at on public.reseller_client_apps;
create trigger trg_reseller_client_apps_updated_at
  before update on public.reseller_client_apps
  for each row execute function public.set_updated_at();
