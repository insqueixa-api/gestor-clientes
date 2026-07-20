-- Cupons de retenção/fidelidade gerenciados pelo bot de atendimento —
-- pedido do Marcio em 2026-07-19. Todos: percentual, gerais (client_id
-- null), sem validade/limite de usos, 1 uso por conta (garantido pela
-- constraint UNIQUE(coupon_id, client_id) já aplicada), BRL-only (regra
-- global já existente pra todo cupom geral), bot_visible = true — são os
-- ÚNICOS cupons que o bot pode enxergar/mencionar sozinho.
--
-- Faixas de dias seguem a convenção de diffDays em
-- lib/whatsapp/template-vars.ts: positivo = campo no passado. Pra
-- vencimento (sempre no passado quando "atrasado"), dias positivos =
-- dias de atraso. Pra cadastro (created_at, sempre no passado), dias
-- positivos = idade da conta.
--
-- Faixas de fidelidade são mutuamente exclusivas de propósito (1-2,9
-- anos / 3-4,9 anos / 5+ anos) — um cliente nunca bate em mais de uma ao
-- mesmo tempo. Se por acaso um cliente for elegível a mais de um cupom
-- bot_visible ao mesmo tempo (ex: fidelidade + retenção), a função
-- getCouponPhraseForClient(...,{onlyBotVisible:true}) escolhe o de maior
-- desconto (ver lib/client-portal/coupons.ts).
--
-- Tenant: Marcio (a5ab0672-c845-4c40-96b9-eeed197e04ed).

INSERT INTO coupons (
  tenant_id, code, description, discount_type, discount_value,
  target_status, rule_date_field, rule_days_min, rule_days_max,
  is_active, bot_visible
) VALUES
  (
    'a5ab0672-c845-4c40-96b9-eeed197e04ed', 'RETENCAO15',
    'Retenção — cliente com 15 a 29 dias de atraso (bot de atendimento)',
    'percent', 15,
    NULL, 'vencimento', 15, 29,
    true, true
  ),
  (
    'a5ab0672-c845-4c40-96b9-eeed197e04ed', 'RETENCAO30',
    'Retenção — cliente com 30 a 60 dias de atraso (bot de atendimento)',
    'percent', 30,
    NULL, 'vencimento', 30, 60,
    true, true
  ),
  (
    'a5ab0672-c845-4c40-96b9-eeed197e04ed', 'BOASVINDAS',
    'Boas-vindas — cliente em teste (trial), primeira renovação (bot de atendimento)',
    'percent', 10,
    ARRAY['TRIAL'], NULL, NULL, NULL,
    true, true
  ),
  (
    'a5ab0672-c845-4c40-96b9-eeed197e04ed', 'FIDELIDADE1',
    'Fidelidade — 1 a 2,9 anos de cadastro (bot de atendimento)',
    'percent', 15,
    NULL, 'cadastro', 365, 1094,
    true, true
  ),
  (
    'a5ab0672-c845-4c40-96b9-eeed197e04ed', 'FIDELIDADE3',
    'Fidelidade — 3 a 4,9 anos de cadastro (bot de atendimento)',
    'percent', 20,
    NULL, 'cadastro', 1095, 1824,
    true, true
  ),
  (
    'a5ab0672-c845-4c40-96b9-eeed197e04ed', 'FIDELIDADE5',
    'Fidelidade — 5+ anos de cadastro (bot de atendimento)',
    'percent', 30,
    NULL, 'cadastro', 1825, NULL,
    true, true
  );

-- Aplicado em produção em 2026-07-19.
