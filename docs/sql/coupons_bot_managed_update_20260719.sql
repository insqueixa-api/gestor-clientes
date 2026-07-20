-- Ajustes pedidos pelo Marcio depois de ver os 6 cupons de retenção/
-- fidelidade em produção (mesmo dia, 2026-07-19):
--
-- 1) Novo cupom RETENCAO7 — faixa mais leve de atraso (7 a 14 dias),
--    10% de desconto. Junto com RETENCAO15 (15-29d) e RETENCAO30 (30-60d)
--    forma uma escada de 3 degraus por tempo de atraso.
--
-- 2) Regra nova: TODO cupom bot-managed que NÃO seja de retenção (óbvio
--    que retenção é pra cliente atrasado) exige cliente ATIVO — antes
--    FIDELIDADE1/3/5 não tinham target_status, então (por padrão do
--    matchesTargeting) valiam pra ACTIVE+OVERDUE junto. Corrigido pra
--    ["ACTIVE"] só. BOASVINDAS já é target_status=["TRIAL"] (categoria
--    própria, não afetada por esta regra).

INSERT INTO coupons (
  tenant_id, code, description, discount_type, discount_value,
  target_status, rule_date_field, rule_days_min, rule_days_max,
  is_active, bot_visible
) VALUES (
  'a5ab0672-c845-4c40-96b9-eeed197e04ed', 'RETENCAO7',
  'Retenção — cliente com 7 a 14 dias de atraso (bot de atendimento)',
  'percent', 10,
  NULL, 'vencimento', 7, 14,
  true, true
);

UPDATE coupons
SET target_status = ARRAY['ACTIVE']
WHERE tenant_id = 'a5ab0672-c845-4c40-96b9-eeed197e04ed'
  AND code IN ('FIDELIDADE1', 'FIDELIDADE3', 'FIDELIDADE5');

-- Aplicado em produção em 2026-07-19.
