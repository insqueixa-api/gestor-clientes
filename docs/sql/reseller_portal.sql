-- docs/sql/reseller_portal.sql
-- 06/10/2026 — Portal da Revenda (docs/revenda-portal/PLANO.md, fase 2).
--
-- Link e sessão da REVENDA em tabelas próprias, de propósito:
--   - client_portal_tokens/sessions são amarrados à identidade de CLIENTE
--     (portal_start_session recusa token sem cliente; o cron
--     cleanup_orphaned_portal_tokens apaga token "órfão" de cliente) — um
--     token de revenda ali seria recusado ou apagado de madrugada;
--   - o login do cliente continua byte a byte igual: a rota de login só olha
--     estas tabelas quando o token NÃO é de cliente.
-- Mesmo formato de link do cliente (unigestor.net.br/#t=TOKEN).
-- Só o servidor (service role) lê/grava. Nada exposto pro anon/authenticated.

alter table public.resellers
  add column if not exists portal_disabled_at timestamptz; -- "Desvinculado do portal"

create table if not exists public.reseller_portal_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  token text not null unique,
  label text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
-- 1 link ativo por revenda (Trocar link desativa o anterior)
create unique index if not exists reseller_portal_tokens_one_active
  on public.reseller_portal_tokens (reseller_id) where is_active;

create table if not exists public.reseller_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  session_token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz
);
create index if not exists reseller_portal_sessions_reseller on public.reseller_portal_sessions (reseller_id);

alter table public.reseller_portal_tokens enable row level security;
alter table public.reseller_portal_sessions enable row level security;
revoke all on public.reseller_portal_tokens from anon, authenticated;
revoke all on public.reseller_portal_sessions from anon, authenticated;
grant all on public.reseller_portal_tokens to service_role;
grant all on public.reseller_portal_sessions to service_role;
