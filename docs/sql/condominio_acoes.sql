-- Módulo Condomínio (fase 2: Ações/notícias) — itens do jornalzinho de cada
-- condomínio (obras, manutenções, avisos), com fotos e status de andamento.
-- Migra a funcionalidade do protótipo local (C:\Users\Marcio\Gestor de
-- Clientes\Vidamerica, lib/types.ts) pra dentro do Unigestor, multi-tenant e
-- multi-condomínio (lá era single-user, um JSON só, sem tenant).
--
-- Categoria fica como texto livre (não uma tabela à parte) — a UI oferece as
-- 11 categorias fixas do protótipo (portaria, obras, limpeza, hidraulica,
-- eletrica, cameras, juridico, lazer, colaboradores, comunicado, outro) mais
-- uma opção "Outra" com texto livre; não precisa de RLS/query a mais só pra
-- isso.
--
-- "arquivada" é novo (não existia no protótipo local, que só tinha
-- create/update/delete puro) — pedido do Márcio pra poder arquivar/restaurar
-- em vez de excluir de vez.

CREATE TABLE IF NOT EXISTS condominio_acoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  condominio_id uuid not null references condominios(id) on delete cascade,
  titulo text not null,
  categoria text not null default 'outro',
  texto text,
  status text not null default 'planejado'
    check (status in ('futuro','planejado','em_andamento','pausado','concluido')),
  fotos jsonb not null default '[]'::jsonb,
  arquivada boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

COMMENT ON COLUMN condominio_acoes.status IS 'Mesmo enum do protótipo local — usado pra agrupar/ordenar as seções do PDF quando essa fase for implementada (concluído em destaque primeiro, futuro por último).';
COMMENT ON COLUMN condominio_acoes.fotos IS 'Array de {url, legenda} — url aponta pro R2 (mesmo bucket/fluxo de upload+compressão do logo do condomínio).';

CREATE INDEX IF NOT EXISTS idx_condominio_acoes_lista
  ON condominio_acoes (tenant_id, condominio_id, arquivada);

ALTER TABLE condominio_acoes ENABLE ROW LEVEL SECURITY;

-- Mesmo padrão de CRUD direto do browser (authenticated) usado em
-- condominios.sql/coupons.sql — esta área não tem rota de API própria pro
-- CRUD (só a revisão por IA usa uma rota, pela GEMINI_API_KEY).
CREATE POLICY admin_select_own_tenant ON condominio_acoes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = condominio_acoes.tenant_id));

CREATE POLICY admin_insert_own_tenant ON condominio_acoes
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = condominio_acoes.tenant_id));

CREATE POLICY admin_update_own_tenant ON condominio_acoes
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = condominio_acoes.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = condominio_acoes.tenant_id));

CREATE POLICY admin_delete_own_tenant ON condominio_acoes
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = condominio_acoes.tenant_id));

CREATE POLICY service_role_all ON condominio_acoes
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_condominio_acoes_updated_at ON condominio_acoes;
CREATE TRIGGER trg_condominio_acoes_updated_at
  BEFORE UPDATE ON condominio_acoes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
