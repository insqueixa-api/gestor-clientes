-- docs/sql/reseller_credit_packages.sql
-- 06/10/2026 — "Tabela Revenda": pacotes de crédito (só BRL) por servidor.
-- Uma linha de 5 pacotes por servidor que tem envio de crédito pela API
-- (NaTV primeiro; Elite/Fast entram quando a API deles for integrada).
-- Separada de plan_tables DE PROPÓSITO: plan_tables é IPTV (créditos 1/2/3/6/12,
-- 1–3 telas) e aparece em todo lugar que lista plano de cliente (portal,
-- cadastro, filtros) — tabela de revenda não pode vazar pra lá.
-- O preço vai direto pra "Recarga rápida" da revenda.
create table if not exists public.reseller_credit_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  credits integer not null check (credits > 0),
  price_brl numeric(12, 2) check (price_brl is null or price_brl >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, server_id, position)
);

alter table public.reseller_credit_packages enable row level security;

drop policy if exists rcp_all_by_tenant on public.reseller_credit_packages;
create policy rcp_all_by_tenant on public.reseller_credit_packages
  for all to authenticated
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = reseller_credit_packages.tenant_id
      and tm.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = reseller_credit_packages.tenant_id
      and tm.user_id = (select auth.uid())
  ));

revoke all on public.reseller_credit_packages from anon;
grant select, insert, update, delete on public.reseller_credit_packages to authenticated;
grant all on public.reseller_credit_packages to service_role;

drop trigger if exists trg_reseller_credit_packages_updated_at on public.reseller_credit_packages;
create trigger trg_reseller_credit_packages_updated_at
  before update on public.reseller_credit_packages
  for each row execute function public.set_updated_at();

-- Semente: servidores NaTV ganham 10/20/30/50/100 créditos (preço a definir)
insert into public.reseller_credit_packages (tenant_id, server_id, position, credits)
select s.tenant_id, s.id, p.position, p.credits
from public.servers s
join public.server_integrations si on si.id = s.panel_integration
cross join (values (1, 10), (2, 20), (3, 30), (4, 50), (5, 100)) as p(position, credits)
where upper(si.provider) = 'NATV' and not s.is_archived
on conflict (tenant_id, server_id, position) do nothing;
