-- Bot de atendimento (WhatsApp) ganha consciência de cupons de
-- retenção/fidelidade — precisa de uma flag pra separar "cupons que o
-- bot pode mencionar sozinho" de "cupons de campanha que o Marcio
-- divulga por conta própria" (envio_agora/envio_programado continuam
-- usando {cupom_frase} sem essa restrição — canal diferente).

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS bot_visible boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN coupons.bot_visible IS 'Só cupons marcados aqui são elegíveis pra o bot de atendimento interativo mencionar (lib/whatsapp/bot-engine.ts) — todo o resto (campanhas manuais via WhatsApp em massa) fica de fora, mesmo que o cliente seria elegível pelas regras normais de findEligibleCoupon.';

-- Aplicado em produção em 2026-07-19.
