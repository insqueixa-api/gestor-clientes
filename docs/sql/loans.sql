-- Empréstimos pessoais (tela Financeiro Pessoal, /admin/settings/financeiro_pessoal).
--
-- Contexto: o Márcio empresta dinheiro informalmente (ex: pra família) sem
-- data nem valor de devolução combinado — a pessoa paga aos poucos, quando
-- consegue. Isso não cabe no modelo normal de fin_transacoes (que exige
-- data_vencimento e trata "vencido" como problema): um empréstimo é só uma
-- despesa (saiu dinheiro) e cada pagamento recebido depois é uma receita
-- (entrou dinheiro) normais, só que "marcadas" com a pessoa pra dar pra
-- somar o saldo devedor. fin_emprestimos é só essa etiqueta — não duplica
-- nem substitui fin_transacoes.
--
-- Saldo devedor de uma pessoa = soma das DESPESA pagas com esse
-- emprestimo_id menos a soma das RECEITA pagas com esse emprestimo_id
-- (calculado ao vivo pela tela, não fica guardado em coluna nenhuma).

CREATE TABLE IF NOT EXISTS fin_emprestimos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  nome text not null,
  observacoes text,
  quitado boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

COMMENT ON TABLE fin_emprestimos IS 'Pessoa/contato de um empréstimo informal — o histórico de valores fica em fin_transacoes.emprestimo_id, isso aqui só agrupa por pessoa.';
COMMENT ON COLUMN fin_emprestimos.quitado IS 'Marcado manualmente quando a dívida foi encerrada (paga ou perdoada) — só tira da lista padrão, não apaga o histórico.';

ALTER TABLE fin_transacoes ADD COLUMN IF NOT EXISTS emprestimo_id uuid
  REFERENCES fin_emprestimos(id) ON DELETE SET NULL;

COMMENT ON COLUMN fin_transacoes.emprestimo_id IS 'Preenchido quando o lançamento é um "Emprestei" (DESPESA) ou "Recebi pagamento" (RECEITA) de um empréstimo informal — null pra qualquer lançamento normal.';

CREATE INDEX IF NOT EXISTS idx_fin_transacoes_emprestimo
  ON fin_transacoes (emprestimo_id) WHERE emprestimo_id IS NOT NULL;

ALTER TABLE fin_emprestimos ENABLE ROW LEVEL SECURITY;

-- Mesmo padrão de CRUD direto do browser (authenticated) usado em coupons.sql
-- — a tela de Financeiro Pessoal não tem rotas de API própria, tudo é via
-- supabaseBrowser.
CREATE POLICY admin_select_own_tenant ON fin_emprestimos
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = fin_emprestimos.tenant_id));

CREATE POLICY admin_insert_own_tenant ON fin_emprestimos
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = fin_emprestimos.tenant_id));

CREATE POLICY admin_update_own_tenant ON fin_emprestimos
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = fin_emprestimos.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = fin_emprestimos.tenant_id));

CREATE POLICY admin_delete_own_tenant ON fin_emprestimos
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = fin_emprestimos.tenant_id));

CREATE POLICY service_role_all ON fin_emprestimos
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS trg_fin_emprestimos_updated_at ON fin_emprestimos;
CREATE TRIGGER trg_fin_emprestimos_updated_at
  BEFORE UPDATE ON fin_emprestimos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
