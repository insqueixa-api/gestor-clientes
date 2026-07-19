-- Rate limit anti-abuso pra cupom (pedido do Marcio depois da auditoria de
-- segurança em 2026-07-19): se a MESMA CONTA (client_id) tentar 5 CÓDIGOS
-- DIFERENTES de cupom, bloqueia novas tentativas por um tempo — mesmo que
-- o 5º código tentado seja válido, ainda assim bloqueia (decisão
-- explícita: desestimula ficar "catando" código por tentativa e erro).
--
-- Escopo por client_id, não por whatsapp_username/sessão — mesma
-- arquitetura já usada em pendência, cupom (1 uso) e pagamento neste
-- feature inteiro: tudo é por conta (client_id = username do servidor),
-- nunca pela pessoa/identidade toda (ver lib/client-portal/coupons.ts,
-- correção "cupom não é por cliente e sim por username do servidor").
--
-- 1 linha por (tenant_id, client_id); reseta sozinha quando o bloqueio
-- expira (ver lib/client-portal/coupons.ts::checkCouponAbuseGuard).
--
-- Só é escrita/lida pelo backend (service_role) — nunca exposta ao browser
-- (nem admin nem portal), então RLS só precisa da policy de service_role.

CREATE TABLE IF NOT EXISTS coupon_abuse_guard (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  client_id uuid not null references clients(id) on delete cascade,
  codes_tried text[] not null default '{}',
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, client_id)
);

COMMENT ON TABLE coupon_abuse_guard IS 'Rate limit de tentativas de cupom por CONTA (client_id) — bloqueia depois de N códigos diferentes tentados numa janela.';
COMMENT ON COLUMN coupon_abuse_guard.codes_tried IS 'Códigos (uppercase) já tentados na janela atual — quando codesTried.length >= limite, ativa blocked_until. Reseta quando o bloqueio anterior expira.';

ALTER TABLE coupon_abuse_guard ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON coupon_abuse_guard
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Aplicado em produção em 2026-07-19.
