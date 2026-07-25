-- Solicitações de configuração manual de aplicativo (Bloco 3 do portal do
-- cliente, /renew-beta) — para apps SEM integração automática (integration
-- type null, ou handler com useApi:false como o IboSol hoje bloqueado por
-- Cloudflare). Nesses casos o cliente não tem como "Reconfigurar" sozinho;
-- em vez disso ele clica "Solicitar configuração" no portal, isso cria uma
-- linha aqui (pending) + notificação pro admin, que resolve manualmente
-- (painel do parceiro via extensão, etc.) e marca como concluído na
-- Auditoria — vira o log consultável da aba "Aplicativos".
--
-- Separado de client_alerts (pendência FINANCEIRA) de propósito: isso é uma
-- pendência OPERACIONAL, não entra em pending-charges/create-payment.

CREATE TABLE IF NOT EXISTS client_app_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  client_id uuid not null references clients(id) on delete cascade,
  client_app_id uuid references client_apps(id) on delete set null,
  app_name text not null,
  fields_snapshot jsonb,
  status text not null default 'pending' check (status in ('pending','done','cancelled')),
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

COMMENT ON COLUMN client_app_requests.client_app_id IS 'SET NULL se o cliente remover o app depois de pedir — o log fica, só perde o vínculo direto.';
COMMENT ON COLUMN client_app_requests.app_name IS 'Snapshot do nome do app no momento do pedido (sobrevive mesmo se client_app_id virar null).';
COMMENT ON COLUMN client_app_requests.fields_snapshot IS 'Cópia de client_apps.field_values no momento do pedido (MAC/Device Key/Obs) — contexto pro admin resolver sem precisar abrir o cadastro do cliente.';

CREATE INDEX IF NOT EXISTS idx_client_app_requests_tenant_status ON client_app_requests (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_client_app_requests_client ON client_app_requests (client_id);

ALTER TABLE client_app_requests ENABLE ROW LEVEL SECURITY;

-- Leitura + conclusão pelo admin do tenant. Criação é sempre via rota do
-- portal (service_role) — nunca direto do browser do cliente nem do admin.
CREATE POLICY admin_select_own_tenant ON client_app_requests
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = client_app_requests.tenant_id));

CREATE POLICY admin_update_own_tenant ON client_app_requests
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = client_app_requests.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = client_app_requests.tenant_id));

CREATE POLICY service_role_all ON client_app_requests
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_client_app_requests_updated_at ON client_app_requests;
CREATE TRIGGER trg_client_app_requests_updated_at
  BEFORE UPDATE ON client_app_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- notifications.type tem CHECK fixo (fin_vencido/transfer_aguardando/
-- manual_pending/whatsapp_falha/automacao_falha/saldo_baixo/
-- sugestao_conteudo) — adiciona o tipo novo usado pelo sino quando o
-- cliente pede configuração manual de app no portal.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'fin_vencido','transfer_aguardando','manual_pending','whatsapp_falha',
    'automacao_falha','saldo_baixo','sugestao_conteudo','app_setup_pending'
  ]));

-- Aplicado em produção em 2026-07-24.
