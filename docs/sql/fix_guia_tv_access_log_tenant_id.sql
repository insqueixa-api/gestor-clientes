-- guia_tv_access_log.tenant_id tinha uma FK apontando para auth.users(id)
-- em vez de tenants(id) — provável erro de digitação na criação da coluna.
-- Isso impedia gravar o tenant_id real (que referencia tenants, não
-- auth.users), o que por sua vez fazia o endpoint de log de acesso do
-- Guia TV nunca atribuir o tenant, e o card "Dados de Uso" agregar
-- acesso de todos os tenants (hoje só existe 1, então sem impacto prático
-- ainda, mas seria um vazamento real com um segundo tenant).

ALTER TABLE guia_tv_access_log
  DROP CONSTRAINT guia_tv_access_log_tenant_id_fkey;

ALTER TABLE guia_tv_access_log
  ADD CONSTRAINT guia_tv_access_log_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Backfill: as 46 linhas existentes ficaram com tenant_id NULL desde sempre
-- (a rota de gravação nunca preenchia essa coluna). Como só existe 1 tenant
-- hoje, não há ambiguidade sobre a quem elas pertencem.
UPDATE guia_tv_access_log
  SET tenant_id = (SELECT id FROM tenants LIMIT 1)
  WHERE tenant_id IS NULL;

-- Reforço de defesa em profundidade: RLS já estava habilitado nessa tabela
-- mas sem nenhuma policy (deny-all para authenticated/anon). As rotas atuais
-- usam a service-role key (que ignora RLS), então isso não travava nada —
-- mas também não protegia nada caso algum código futuro consulte essa
-- tabela direto com a sessão do usuário.
CREATE POLICY guia_tv_access_log_select_by_tenant
  ON guia_tv_access_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tenant_members tm
      WHERE tm.tenant_id = guia_tv_access_log.tenant_id
        AND tm.user_id = auth.uid()
    )
  );
