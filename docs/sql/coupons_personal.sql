-- Cupom pessoal (indicação): cupom preso a um cliente específico,
-- reutilizável — não usa a regra "1 uso por cliente para sempre"
-- (coupon_redemptions), usa só is_active. Ao ser resgatado, a Fase 2
-- (dentro do runFulfillment, ainda não implementada) deve desativar o
-- cupom automaticamente; o Marcio reativa manualmente na próxima
-- indicação. Ver lib/client-portal/coupons.ts.

ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE CASCADE;

COMMENT ON COLUMN coupons.client_id IS 'Se preenchido, cupom pessoal restrito a este cliente. Elegibilidade não usa coupon_redemptions (uso único-pra-sempre) — usa só is_active, e se autodesativa a cada resgate. Null = cupom geral/campanha, regra "1 uso por cliente" continua valendo.';

CREATE INDEX IF NOT EXISTS idx_coupons_client_id ON coupons (client_id) WHERE client_id IS NOT NULL;

-- Aplicado em produção em 2026-07-19.
