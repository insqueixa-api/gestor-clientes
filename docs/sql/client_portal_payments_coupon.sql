-- Fase 2 do cupom de desconto: liga o cupom no fluxo real de pagamento do
-- portal. coupon_code é gravado por cópia (não só o id) pra manter
-- histórico legível mesmo se o cupom for excluído depois.
--
-- IMPORTANTE: coupon_discount_amount nunca é somado a plan_price_amount
-- (o preço que vira o novo price_amount do cliente em
-- lib/client-portal/fulfillment.ts) — o desconto vale só pra esta
-- cobrança, nunca vira o preço fixo do cliente.

ALTER TABLE client_portal_payments
  ADD COLUMN IF NOT EXISTS coupon_id uuid REFERENCES coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coupon_code text,
  ADD COLUMN IF NOT EXISTS coupon_discount_amount numeric(12,2);

COMMENT ON COLUMN client_portal_payments.coupon_code IS 'Cópia do código do cupom no momento da cobrança (mantém histórico legível mesmo se o cupom for excluído depois).';
COMMENT ON COLUMN client_portal_payments.coupon_discount_amount IS 'Valor efetivamente descontado nesta cobrança. Nunca é somado a plan_price_amount — o desconto não vira o preço fixo do cliente.';

-- Aplicado em produção em 2026-07-19.
