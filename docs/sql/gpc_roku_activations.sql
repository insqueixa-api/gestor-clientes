-- Controle de validade por MAC pro GPC Roku (achado 26/08/2026, pedido do
-- Márcio): diferente do resto da família GerenciaApp (grátis de verdade pra
-- ele), o GPC Roku tem custo real (assinatura mensal) — ele quem controla
-- ativação/validade, não o parceiro. MAC novo vira teste de 7 dias; MAC
-- pago vira 10 anos a contar do pagamento. Ver lib/apps/gpc-roku-registry.ts
-- e lib/apps/orchestration.ts (configureClientApp) / lib/client-portal/
-- fulfillment.ts (markAppRenewalPaid) pra onde isso é lido/escrito, e
-- app/admin/gerenciador/aplicativo/gpc_roku_activations_modal.tsx pro
-- painel de gerenciamento manual (ver/cadastrar/editar/remover).
--
-- client_id/client_app_id com FK (não obrigatório, on delete set null) pra
-- permitir o embed do PostgREST no painel de gerenciamento (nome do
-- cliente, usuário/servidor) sem precisar de uma 2ª query.
CREATE TABLE IF NOT EXISTS gpc_roku_activations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  mac text not null,                     -- normalizado uppercase/trim
  client_id uuid references clients(id) on delete set null,
  client_app_id uuid references client_apps(id) on delete set null,
  status text not null default 'trial',  -- 'trial' | 'paid'
  valid_until date not null,
  activated_by text,                     -- e-mail do admin (manual) ou "Sistema (...)" (automático) — null = desconhecido/legado
  activated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gpc_roku_activations_tenant_mac
  ON gpc_roku_activations (tenant_id, mac);

COMMENT ON TABLE gpc_roku_activations IS 'Validade controlada por MAC pro GPC Roku (único membro cobrado da família GerenciaApp) — trial 7 dias em MAC novo, 10 anos ao pagar.';

ALTER TABLE gpc_roku_activations ENABLE ROW LEVEL SECURITY;

-- Mesmo padrão de RLS de api_integrations/app_integrations — service_role
-- (orchestration.ts/fulfillment.ts) ignora RLS; sessão de admin no browser
-- (painel de gerenciamento) passa por esta policy normalmente.
CREATE POLICY tenant_isolation ON gpc_roku_activations
  FOR ALL
  USING (tenant_id = (SELECT tenant_members.tenant_id FROM tenant_members WHERE tenant_members.user_id = auth.uid() LIMIT 1))
  WITH CHECK (tenant_id = (SELECT tenant_members.tenant_id FROM tenant_members WHERE tenant_members.user_id = auth.uid() LIMIT 1));
