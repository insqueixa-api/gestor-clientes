-- Log de atividade dos aplicativos do Bloco 3 do portal do cliente
-- (/renew-beta) — cobre os eventos que hoje são 100% silenciosos pro admin:
-- adicionar app, remover app com integração automática (apaga direto, sem
-- passar por client_app_requests), configurar (sucesso e falha), editar
-- campos e verificar validade. Antes disso só existiam dois "logs" parciais:
-- client_app_requests (só pedidos manuais, apps sem integração) e
-- client_portal_payments (só pagamentos). Auditado em 25/07/2026.
--
-- client_app_id fica nullable de propósito (igual client_app_requests): a
-- linha pode já ter sido apagada (evento "removed") quando o admin for ler
-- o log depois.

CREATE TABLE IF NOT EXISTS client_app_activity_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  client_id uuid not null references clients(id) on delete cascade,
  client_app_id uuid references client_apps(id) on delete set null,
  app_name text not null,
  event text not null check (event in (
    'added',
    'removed',
    'removed_partner_failed',
    'configured',
    'configure_failed',
    'fields_updated',
    'check_validity',
    'check_validity_failed'
  )),
  detail jsonb,
  created_at timestamptz not null default now()
);

COMMENT ON COLUMN client_app_activity_log.app_name IS 'Snapshot do nome do app — sobrevive mesmo se client_app_id virar null (app removido depois).';
COMMENT ON COLUMN client_app_activity_log.detail IS 'Contexto livre por evento: mensagem de erro, expireDate retornado, campos alterados, etc.';
COMMENT ON COLUMN client_app_activity_log.event IS 'removed_partner_failed = apagou localmente mas o painel do parceiro não confirmou a remoção (pode ter ficado resíduo lá, checar manualmente).';

CREATE INDEX IF NOT EXISTS idx_client_app_activity_log_tenant_created ON client_app_activity_log (tenant_id, created_at desc);
CREATE INDEX IF NOT EXISTS idx_client_app_activity_log_client ON client_app_activity_log (client_id, created_at desc);

ALTER TABLE client_app_activity_log ENABLE ROW LEVEL SECURITY;

-- Leitura pelo admin do tenant. Escrita é sempre via rota do portal
-- (service_role) — nunca direto do browser do cliente nem do admin.
CREATE POLICY admin_select_own_tenant ON client_app_activity_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = client_app_activity_log.tenant_id));

CREATE POLICY service_role_all ON client_app_activity_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
