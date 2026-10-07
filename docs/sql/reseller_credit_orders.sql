-- docs/sql/reseller_credit_orders.sql
-- 06/10/2026 — Portal da Revenda: compra de créditos por PIX (Mercado Pago /
-- FastFlow) com envio automático do crédito no painel (NaTV) depois do pago.
--
-- Tabela PRÓPRIA (não client_portal_payments) de propósito: aquela tem
-- client_id obrigatório e alimenta Log do Portal, Auditoria, alertas e
-- receita de cliente — pedido de revenda ali vazaria em tudo isso. Aqui:
--   - id = external_reference do gateway E id da transferência
--     (reseller_credit_transfers.id) → o envio do crédito é no máximo 1 por
--     pedido, mesmo com webhook + polling chegando juntos;
--   - valor SEMPRE calculado no servidor pela Tabela Revenda (pacote exato);
--   - só o servidor (service role) grava; o admin logado só lê.
create table if not exists public.reseller_credit_orders (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  reseller_server_id uuid not null references public.reseller_servers(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  credits integer not null check (credits > 0),
  unit_price numeric(12, 2) not null check (unit_price > 0),
  amount_brl numeric(12, 2) not null check (amount_brl > 0),
  gateway_id uuid,
  gateway_type text not null,
  gateway_payment_id text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'cancelled', 'rejected')),
  fulfillment_status text check (fulfillment_status in ('pending', 'processing', 'done', 'error', 'unknown')),
  fulfillment_error text,
  sale_id uuid,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists reseller_credit_orders_gateway_payment
  on public.reseller_credit_orders (gateway_type, gateway_payment_id)
  where gateway_payment_id is not null;
create index if not exists reseller_credit_orders_reseller_created
  on public.reseller_credit_orders (reseller_id, created_at desc);

alter table public.reseller_credit_orders enable row level security;

drop policy if exists rco_select_by_tenant on public.reseller_credit_orders;
create policy rco_select_by_tenant on public.reseller_credit_orders
  for select to authenticated
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = reseller_credit_orders.tenant_id
      and tm.user_id = (select auth.uid())
  ));

revoke all on public.reseller_credit_orders from anon;
revoke insert, update, delete on public.reseller_credit_orders from authenticated;
grant select on public.reseller_credit_orders to authenticated;
grant all on public.reseller_credit_orders to service_role;

drop trigger if exists trg_reseller_credit_orders_updated_at on public.reseller_credit_orders;
create trigger trg_reseller_credit_orders_updated_at
  before update on public.reseller_credit_orders
  for each row execute function public.set_updated_at();
