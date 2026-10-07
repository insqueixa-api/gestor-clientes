-- docs/sql/reseller_end_clients.sql
-- 07/10/2026 — Portal da Revenda: "Gerenciar clientes e aplicativos"
-- (docs/revenda-portal/PLANO.md, redesenho de 07/10).
--
-- 1) reseller_end_clients: espelho dos clientes da revenda no painel do
--    servidor (hoje NaTV, /report/allusers filtrado pela revenda dona).
--    Atualizado a cada abertura do portal (throttle de 60s do NaTV).
--    Guarda a senha do cliente (igual clients.server_password): o
--    /user/search do NaTV NÃO acha cliente de sub-revenda (testado
--    07/10/2026) e o relatório só aceita 1 chamada/min, então o M3U é
--    montado no servidor a partir daqui (regra principal/secundária,
--    lib/apps/m3u-lists.ts). As rotas do portal nunca devolvem a senha: a
--    revenda não vê o link nem as DNS. anon sem acesso; RLS só membros.
-- 2) reseller_client_apps passa a apontar pro cliente (end_client_id); o
--    link M3U não é mais informado pela revenda (coluna fica opcional) e
--    "Ambiente" vira coluna opcional.
-- 3) resellers.gerenciaapp_limit: máximo de aparelhos GerenciaApp
--    configurados pelo portal ao mesmo tempo (padrão 10, editável na página
--    do revendedor no admin). Remover libera a vaga.

create table if not exists public.reseller_end_clients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reseller_id uuid not null references public.resellers(id) on delete cascade,
  reseller_server_id uuid not null references public.reseller_servers(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  username text not null,
  password text,
  panel_user_id text,
  expires_at timestamptz,
  status text,
  blocked boolean not null default false,
  connections int,
  missing_since timestamptz,               -- sumiu do painel (excluído/transferido)
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (reseller_server_id, username)
);
create index if not exists reseller_end_clients_reseller on public.reseller_end_clients (reseller_id, username);

alter table public.reseller_end_clients enable row level security;
drop policy if exists rec_select_by_tenant on public.reseller_end_clients;
create policy rec_select_by_tenant on public.reseller_end_clients
  for select to authenticated
  using (exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = reseller_end_clients.tenant_id
      and tm.user_id = (select auth.uid())
  ));
revoke all on public.reseller_end_clients from anon;
revoke insert, update, delete on public.reseller_end_clients from authenticated;
grant select on public.reseller_end_clients to authenticated;
grant all on public.reseller_end_clients to service_role;

-- tabela estava vazia (só testes apagados) quando isso rodou
alter table public.reseller_client_apps
  add column if not exists end_client_id uuid references public.reseller_end_clients(id) on delete cascade,
  add column if not exists obs text,
  add column if not exists m3u_list text check (m3u_list in ('principal', 'secundaria')),
  alter column m3u_url drop not null,
  alter column client_label drop not null;
create index if not exists reseller_client_apps_end_client on public.reseller_client_apps (end_client_id);

alter table public.resellers
  add column if not exists gerenciaapp_limit int not null default 10 check (gerenciaapp_limit >= 0);

-- (rodado depois da 1ª versão desta migração)
alter table public.reseller_end_clients add column if not exists password text;

-- vencimento do app no aparelho (Configurar/Verificar/Renovar gravam aqui)
alter table public.reseller_client_apps add column if not exists expire_date date;
