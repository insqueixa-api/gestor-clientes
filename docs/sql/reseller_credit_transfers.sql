-- docs/sql/reseller_credit_transfers.sql
-- 06/10/2026 — envio de crédito pra revenda pela API do servidor (NaTV primeiro).
--
-- A API do NaTV (POST /reseller/credits) NÃO tem chave de idempotência nem
-- como retirar crédito depois: um envio em dobro não tem volta. Esta tabela
-- é a trava:
--   - id = transfer_id gerado UMA vez quando o modal abre → clique duplo ou
--     reenvio da mesma tela cai no mesmo registro (PK) e nunca chama a API 2x;
--   - índice único parcial: no máximo 1 transferência 'pending' ou 'unknown'
--     por vínculo revenda↔servidor → outra recarga fica bloqueada até a
--     anterior ser confirmada (ou marcada como não chegou) pelo Márcio;
--   - só o servidor (service role) grava; o admin logado só lê (RLS).
create table if not exists public.reseller_credit_transfers (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reseller_server_id uuid not null references public.reseller_servers(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  server_integration_id uuid not null references public.server_integrations(id) on delete cascade,
  provider text not null,
  recipient_username text not null,
  amount integer not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'done', 'failed', 'unknown')),
  recipient_credits_before numeric,
  recipient_credits_after numeric,
  caller_credits_before numeric,
  caller_credits_after numeric,
  api_status integer,
  api_response jsonb,
  error text,
  sale_id uuid,
  sale_payload jsonb,
  created_by uuid,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists reseller_credit_transfers_one_open
  on public.reseller_credit_transfers (reseller_server_id)
  where status in ('pending', 'unknown');

create index if not exists reseller_credit_transfers_tenant_created
  on public.reseller_credit_transfers (tenant_id, created_at desc);

alter table public.reseller_credit_transfers enable row level security;

drop policy if exists rct_select_by_tenant on public.reseller_credit_transfers;
create policy rct_select_by_tenant on public.reseller_credit_transfers
  for select to authenticated
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = reseller_credit_transfers.tenant_id
      and tm.user_id = (select auth.uid())
  ));

revoke all on public.reseller_credit_transfers from anon;
revoke insert, update, delete on public.reseller_credit_transfers from authenticated;
grant select on public.reseller_credit_transfers to authenticated;
grant all on public.reseller_credit_transfers to service_role;
