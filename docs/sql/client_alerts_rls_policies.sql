-- client_alerts só tinha a policy "service_role_all" (acesso só pro
-- backend/webhook via service_role). Nunca existiu policy pra "authenticated"
-- (o usuário logado no admin, via supabaseBrowser) — ou seja, criar/editar/
-- excluir alerta pelo admin NUNCA funcionou (o botão existia, mas todo
-- insert/update/delete vinha do navegador e caía em RLS: "new row violates
-- row-level security policy"). Só não tinha sido notado porque a feature
-- nunca tinha sido usada de verdade antes desta sessão.
--
-- Mesmo padrão já usado em client_message_jobs e clients: 4 policies pra
-- "authenticated", escopadas por tenant via tenant_members. A policy
-- service_role_all continua intacta — o webhook (que usa supabaseAdmin/
-- service_role) não é afetado por nada disso.
--
-- Aplicado em produção em 2026-07-18.

CREATE POLICY admin_select_own_tenant ON client_alerts
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = client_alerts.tenant_id));

CREATE POLICY admin_insert_own_tenant ON client_alerts
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = client_alerts.tenant_id));

CREATE POLICY admin_update_own_tenant ON client_alerts
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = client_alerts.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = client_alerts.tenant_id));

CREATE POLICY admin_delete_own_tenant ON client_alerts
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = client_alerts.tenant_id));
