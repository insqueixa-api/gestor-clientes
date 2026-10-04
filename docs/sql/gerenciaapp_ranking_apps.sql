-- docs/sql/gerenciaapp_ranking_apps.sql
-- ✅ 03/10/2026, pedido do Márcio: códigos de app do GerenciaApp
-- (ranking_app_id) editáveis pela tela de Integrações, em vez de fixos no
-- código. Cada linha = 1 app do painel deles (nome livre + código) e,
-- opcionalmente, o app do catálogo que usa esse código.
--   Em uso   = tem código e app vinculado
--   Sem uso  = tem código, nenhum app vinculado
--   Pendente = sem código ainda (ex: PLAYNX, ex-GPC LG, não liberado)
-- Tabela própria de propósito: app_integrations.extra_config do GERENCIAAPP é
-- sobrescrito inteiro pelas rotas renovar/sync-validade.

create table if not exists public.gerenciaapp_ranking_apps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  code integer,
  app_id uuid references public.apps(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists gerenciaapp_ranking_apps_app_uniq
  on public.gerenciaapp_ranking_apps (tenant_id, app_id) where app_id is not null;

alter table public.gerenciaapp_ranking_apps enable row level security;

drop policy if exists tenant_isolation on public.gerenciaapp_ranking_apps;
create policy tenant_isolation on public.gerenciaapp_ranking_apps
  using (tenant_id = (select tenant_members.tenant_id from tenant_members where tenant_members.user_id = auth.uid() limit 1))
  with check (tenant_id = (select tenant_members.tenant_id from tenant_members where tenant_members.user_id = auth.uid() limit 1));

-- Carga inicial (códigos lidos do painel em 03/10/2026, props.allApps do
-- /dashboard) — vincula o app do catálogo que já usava esse código.
insert into public.gerenciaapp_ranking_apps (tenant_id, name, code, app_id)
select ai.tenant_id, v.name, v.code,
       (select a.id from public.apps a where a.tenant_id = ai.tenant_id and a.name = v.app_name limit 1)
from public.app_integrations ai
cross join (values
  ('IBO REVENDA', 10, 'IBO Revenda'),
  ('ZONE X', 11, 'Zone X'),
  ('VU REVENDA', 12, 'VU Revenda'),
  ('FACILITA', 13, null),
  ('UNI REVENDA', 15, 'UNI Revenda'),
  ('TV ROKU - GPC PRO', 17, 'GPC Roku'),
  ('GPC PRO ANDROID', 18, 'GPC Pro'),
  ('Gerencia Max', 21, null),
  ('IBONEW', 22, 'IBONew'),
  ('PLAYNX (ex-GPC LG)', null, null)
) as v(name, code, app_name)
where ai.app_name = 'GERENCIAAPP'
  and not exists (select 1 from public.gerenciaapp_ranking_apps g where g.tenant_id = ai.tenant_id);
