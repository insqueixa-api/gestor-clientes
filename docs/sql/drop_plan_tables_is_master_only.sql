-- Remoção de resquício do antigo sistema de papéis (master/admin/user).
-- is_master_only nunca foi lido por nenhum código do app (só declarado no
-- tipo TS de app/admin/gerenciador/plano/page.tsx) mas ainda era usado pela
-- policy admin_select_own_tenant, que distinguia tabelas "master only"
-- visíveis só para tenant_members.role = 'owner'. Hoje só existe 1 membro
-- no banco inteiro, com role 'owner' — não há mais distinção de papéis em
-- uso, então a policy é simplificada antes de remover a coluna.

DROP POLICY admin_select_own_tenant ON plan_tables;

CREATE POLICY admin_select_own_tenant
  ON plan_tables
  FOR SELECT
  TO public
  USING (
    (EXISTS (
      SELECT 1 FROM tenant_members tm
      WHERE tm.user_id = auth.uid() AND tm.tenant_id = plan_tables.tenant_id
    ))
    OR is_system_default = true
  );

ALTER TABLE plan_tables
  DROP COLUMN is_master_only;
