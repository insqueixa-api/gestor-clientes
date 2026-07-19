-- Cupons de desconto (fluxo de renovação do portal do cliente).
--
-- Contexto: desconto configurável pelo admin (percentual ou valor fixo),
-- com validade, regra de campanha (ex: cliente com mais de X dias de
-- cadastro) e limite total de usos. O uso "1 por cliente / não cumulativo"
-- é regra fixa, aplicada no código na hora de validar — não vira coluna.
--
-- O desconto do cupom incide SOMENTE sobre o valor do plano, nunca sobre
-- pendências financeiras (client_alerts) — essas continuam cobradas 100%.
--
-- Clientes com preço override no plano/período atual (mesma regra já usada
-- em create-payment/route.ts: clientOverride > 0 && período == plano atual)
-- não são elegíveis a nenhum cupom nesse plano/período.

CREATE TABLE IF NOT EXISTS coupons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  description text,
  discount_type text not null check (discount_type in ('percent','fixed')),
  discount_value numeric(12,2) not null check (discount_value > 0),
  currency text,
  min_account_age_days integer,
  starts_at timestamptz,
  ends_at timestamptz,
  max_total_redemptions integer,
  is_active boolean not null default true,
  message_template text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

COMMENT ON COLUMN coupons.code IS 'Código digitado pelo cliente no portal (uppercase, único por tenant).';
COMMENT ON COLUMN coupons.discount_type IS 'percent = % sobre o valor do plano; fixed = valor fixo abatido (na moeda de coupons.currency, convertido pra moeda do cliente na hora de aplicar).';
COMMENT ON COLUMN coupons.currency IS 'Obrigatório apenas quando discount_type = fixed.';
COMMENT ON COLUMN coupons.min_account_age_days IS 'Regra de campanha opcional: cliente precisa ter pelo menos N dias de cadastro (clients.created_at). Null = sem regra.';
COMMENT ON COLUMN coupons.starts_at IS 'Null = sem data de início definida (já vale).';
COMMENT ON COLUMN coupons.ends_at IS 'Null = sem validade (cupom definitivo até ser desativado).';
COMMENT ON COLUMN coupons.max_total_redemptions IS 'Limite global de usos do cupom (soma de todos os clientes). Null = sem limite.';
COMMENT ON COLUMN coupons.message_template IS 'Frase customizada pra tag {cupom_frase} nas mensagens automáticas, com tokens {codigo}/{desconto}. Null = usa frase padrão do sistema.';

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  coupon_id uuid not null references coupons(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  payment_id uuid references client_portal_payments(id) on delete set null,
  discount_amount numeric(12,2) not null,
  currency text not null,
  created_at timestamptz not null default now()
);

COMMENT ON TABLE coupon_redemptions IS 'Histórico/auditoria de uso de cupons — 1 linha por aplicação bem-sucedida. Garante "1 uso por cliente" (checar existência por coupon_id+client_id) e alimenta o contador de max_total_redemptions.';

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON coupon_redemptions (coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_client_coupon ON coupon_redemptions (client_id, coupon_id);

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;

-- coupons: CRUD normal pelo admin, escopado ao tenant.
CREATE POLICY admin_select_own_tenant ON coupons
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = coupons.tenant_id));

CREATE POLICY admin_insert_own_tenant ON coupons
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = coupons.tenant_id));

CREATE POLICY admin_update_own_tenant ON coupons
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = coupons.tenant_id))
  WITH CHECK (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = coupons.tenant_id));

CREATE POLICY admin_delete_own_tenant ON coupons
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = coupons.tenant_id));

CREATE POLICY service_role_all ON coupons
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- coupon_redemptions: só leitura pro admin (histórico); escrita é sempre
-- via backend (service_role), nunca direto do browser.
CREATE POLICY admin_select_own_tenant ON coupon_redemptions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = auth.uid() AND tm.tenant_id = coupon_redemptions.tenant_id));

CREATE POLICY service_role_all ON coupon_redemptions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- updated_at automático, mesmo padrão de clients/servers/plan_tables (função
-- set_updated_at() já existe no banco).
DROP TRIGGER IF EXISTS trg_coupons_updated_at ON coupons;
CREATE TRIGGER trg_coupons_updated_at
  BEFORE UPDATE ON coupons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Aplicado em produção em 2026-07-19.
