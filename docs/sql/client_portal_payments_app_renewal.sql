-- Pagamento avulso de licença de aplicativo (Bloco 3 do portal,
-- /renew-beta/apps/[id], botão "Renovar aplicativo") — reaproveita a MESMA
-- tabela/infraestrutura de client_portal_payments (webhook MP/Stripe já
-- validado, RLS já testada) em vez de criar um sistema de pagamento
-- paralelo. O que muda é só o "tipo": paga SÓ o preço da licença do app
-- (apps.license_price), nunca mexe em client.vencimento nem na assinatura
-- IPTV do cliente.
--
-- payment_type = 'subscription' é o valor padrão — TODO pagamento que já
-- existia continua exatamente como estava, sem nenhuma migração de dados
-- necessária. O webhook/payment-status passam a checar essa coluna pra
-- decidir qual fulfillment rodar (renovação de assinatura vs. só marcar a
-- licença do app como paga).

ALTER TABLE client_portal_payments
  ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'subscription'
    CHECK (payment_type IN ('subscription','app_renewal')),
  ADD COLUMN IF NOT EXISTS client_app_id uuid REFERENCES client_apps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS app_name_snapshot text;

COMMENT ON COLUMN client_portal_payments.payment_type IS 'subscription = renovação da assinatura IPTV (fluxo de sempre); app_renewal = pagamento avulso da licença de um app específico, não mexe na assinatura.';
COMMENT ON COLUMN client_portal_payments.client_app_id IS 'Só preenchido quando payment_type=app_renewal. SET NULL se o cliente excluir o app depois — o log financeiro fica, só perde o vínculo direto.';
COMMENT ON COLUMN client_portal_payments.app_name_snapshot IS 'Nome do app no momento do pagamento (sobrevive mesmo se client_app_id virar null) — pra Auditoria mostrar exatamente do que se tratou o pagamento.';

CREATE INDEX IF NOT EXISTS idx_client_portal_payments_client_app ON client_portal_payments (client_app_id) WHERE client_app_id IS NOT NULL;

-- Aplicado em produção em 2026-07-25.
