-- Módulo Condomínio (fase 3: Edições/geração de PDF) — uma Edição é o
-- "jornalzinho" em si: um recorte ordenado de Ações (título/tipo/data/
-- introdução), gerado sob demanda em PDF por um serviço rodando numa VM
-- (não em função serverless — Puppeteer/Chromium não cabe bem lá, ver
-- app/api/admin/condominio/gerar-pdf/route.ts).
--
-- "itens" guarda um SNAPSHOT leve dos dados da Ação no momento (título,
-- categoria, texto, status, fotos) — não é FK pra condominio_acoes. Migra o
-- mesmo comportamento do protótipo local (Vidamerica/lib/types.ts,
-- ItemEdicao): a edição não muda retroativamente se a Ação original for
-- editada/excluída depois, e ao "publicar" o conteúdo já está
-- naturalmente congelado (só paramos de deixar editar).

CREATE TABLE IF NOT EXISTS condominio_edicoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  condominio_id uuid not null references condominios(id) on delete cascade,
  titulo text not null,
  tipo text not null check (tipo in ('semanal','mensal')),
  data_referencia date not null,
  periodo_chave text not null,
  versao int not null default 1,
  status text not null default 'rascunho' check (status in ('rascunho','publicado')),
  introducao text,
  itens jsonb not null default '[]'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

COMMENT ON COLUMN condominio_edicoes.periodo_chave IS 'Agrupa versões do mesmo período — ex: "semanal:2026-08-17" (segunda-feira da semana) ou "mensal:2026-08-01" (dia 1 do mês). Igual protótipo local.';
COMMENT ON COLUMN condominio_edicoes.itens IS 'Snapshot leve e ORDENADO das Ações escolhidas — [{acao_id, titulo, categoria, texto, status, fotos}]. A ordem é a ordem de exibição no PDF.';

-- Só um rascunho aberto por período/condomínio — gerar de novo no mesmo
-- período sobrescreve esse rascunho (upsert), nunca cria um segundo. Depois
-- de publicado, a próxima geração no mesmo período cria um NOVO rascunho
-- (índice não bloqueia, porque só filtra status='rascunho').
CREATE UNIQUE INDEX IF NOT EXISTS idx_condominio_edicoes_rascunho_unico
  ON condominio_edicoes (tenant_id, condominio_id, periodo_chave)
  WHERE status = 'rascunho';

CREATE INDEX IF NOT EXISTS idx_condominio_edicoes_lista
  ON condominio_edicoes (tenant_id, condominio_id, created_at desc);

ALTER TABLE condominio_edicoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_select_own_tenant ON condominio_edicoes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = condominio_edicoes.tenant_id));

CREATE POLICY admin_insert_own_tenant ON condominio_edicoes
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = condominio_edicoes.tenant_id));

CREATE POLICY admin_update_own_tenant ON condominio_edicoes
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = condominio_edicoes.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = condominio_edicoes.tenant_id));

CREATE POLICY admin_delete_own_tenant ON condominio_edicoes
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = condominio_edicoes.tenant_id));

CREATE POLICY service_role_all ON condominio_edicoes
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_condominio_edicoes_updated_at ON condominio_edicoes;
CREATE TRIGGER trg_condominio_edicoes_updated_at
  BEFORE UPDATE ON condominio_edicoes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
