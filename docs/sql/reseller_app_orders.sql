-- docs/sql/reseller_app_orders.sql
-- 07/10/2026 — Portal da Revenda, etapa 2: a revenda paga (PIX) a ativação
-- de licença de app (AtivaApp / DupleCast) do cliente dela.
-- Mesmo desenho de reseller_credit_orders (docs/sql/reseller_credit_orders.sql):
--   - valor SEMPRE do sistema (apps.license_price), nunca do navegador;
--   - o status do PIX é reconsultado no gateway (webhook ou polling) e o
--     VALOR pago é conferido antes de ativar;
--   - trava atômica pending → processing: no máximo 1 ativação por pedido;
--   - 1 pedido "em aberto" por aparelho (índice parcial abaixo): não dá pra
--     pagar 2x a ativação do mesmo aparelho enquanto a 1ª não terminou.
-- Separada de client_portal_payments e de reseller_credit_orders de propósito.

create table if not exists public.reseller_app_orders (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  app_id uuid not null references public.apps(id) on delete restrict,
  app_name text not null,
  reseller_client_app_id uuid references public.reseller_client_apps(id) on delete set null,
  end_client_username text,                 -- cliente da revenda (quando veio do card)
  field_values jsonb not null default '{}'::jsonb,
  device_key text not null,                 -- identificador normalizado (MAC/e-mail) — trava de duplicidade
  prev_expire_date date,                    -- vencimento lido antes de cobrar (null = sem consulta)
  amount_brl numeric(12, 2) not null check (amount_brl > 0),
  gateway_id uuid,
  gateway_type text not null,
  gateway_payment_id text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'cancelled', 'rejected')),
  fulfillment_status text check (fulfillment_status in ('pending', 'processing', 'activating', 'done', 'error', 'unknown')),
  fulfillment_error text,
  provider text check (provider in ('appativa', 'duplecast')),
  appativa_historico_id text,
  duplecast_code text,
  new_expire_date date,
  whatsapp_status text check (whatsapp_status in ('sent', 'error', 'na')),
  paid_at timestamptz,
  fulfilled_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists reseller_app_orders_gateway_payment
  on public.reseller_app_orders (gateway_type, gateway_payment_id)
  where gateway_payment_id is not null;
create unique index if not exists reseller_app_orders_appativa
  on public.reseller_app_orders (appativa_historico_id)
  where appativa_historico_id is not null;
create index if not exists reseller_app_orders_reseller_created
  on public.reseller_app_orders (reseller_id, created_at desc);
-- 1 pedido PAGO em andamento por aparelho (o pendente de pagamento é
-- reaproveitado/cancelado no código; este índice é a garantia do pago)
create unique index if not exists reseller_app_orders_one_open_paid
  on public.reseller_app_orders (tenant_id, app_id, device_key)
  where status = 'approved' and fulfillment_status in ('pending', 'processing', 'activating', 'unknown');

alter table public.reseller_app_orders enable row level security;

drop policy if exists rao_select_by_tenant on public.reseller_app_orders;
create policy rao_select_by_tenant on public.reseller_app_orders
  for select to authenticated
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = reseller_app_orders.tenant_id
      and tm.user_id = (select auth.uid())
  ));

revoke all on public.reseller_app_orders from anon;
revoke insert, update, delete on public.reseller_app_orders from authenticated;
grant select on public.reseller_app_orders to authenticated;
grant all on public.reseller_app_orders to service_role;

drop trigger if exists trg_reseller_app_orders_updated_at on public.reseller_app_orders;
create trigger trg_reseller_app_orders_updated_at
  before update on public.reseller_app_orders
  for each row execute function public.set_updated_at();
