-- Módulo Condomínio (fase 1: cadastro) — o Márcio administra mais de um
-- condomínio (igual clientes/servidores), cada um com seus dados básicos.
-- Esses dados (nome, logo, endereço, contato, gestão, 2 slogans, 2 cores)
-- vão alimentar o cabeçalho/rodapé do informativo em PDF gerado por
-- condomínio em fase futura — aqui só o cadastro.
--
-- Contexto do PDF: replica o modelo já usado no protótipo local
-- (C:\Users\Marcio\Gestor de Clientes\Vidamerica), que gera um "jornalzinho"
-- semanal com notícias de obras/manutenção. Notícias, arquivamento e geração
-- de PDF ficam para uma tabela/fase separada — isso aqui é só o cadastro do
-- condomínio em si.

CREATE TABLE IF NOT EXISTS condominios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  nome text not null,
  logo_url text,
  endereco text,
  contato text,
  gestao text,
  slogan1 text,
  slogan2 text,
  cor_primaria text,
  cor_secundaria text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

COMMENT ON COLUMN condominios.cor_primaria IS 'Hex (#RRGGBB) — usado no cabeçalho/rodapé do PDF gerado. Null = usa a cor padrão do sistema.';
COMMENT ON COLUMN condominios.cor_secundaria IS 'Hex (#RRGGBB) — idem, segunda cor da identidade visual do condomínio.';
COMMENT ON COLUMN condominios.gestao IS 'Texto livre (ex: nome da administradora/síndico) — aparece no rodapé do informativo.';

ALTER TABLE condominios ENABLE ROW LEVEL SECURITY;

-- Mesmo padrão de CRUD direto do browser (authenticated) usado em
-- coupons.sql e loans.sql — esta área não tem rota de API própria, tudo é
-- via supabaseBrowser.
CREATE POLICY admin_select_own_tenant ON condominios
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = condominios.tenant_id));

CREATE POLICY admin_insert_own_tenant ON condominios
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = condominios.tenant_id));

CREATE POLICY admin_update_own_tenant ON condominios
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = condominios.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = condominios.tenant_id));

CREATE POLICY admin_delete_own_tenant ON condominios
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = condominios.tenant_id));

CREATE POLICY service_role_all ON condominios
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_condominios_updated_at ON condominios;
CREATE TRIGGER trg_condominios_updated_at
  BEFORE UPDATE ON condominios
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
