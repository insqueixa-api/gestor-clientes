-- Renovação antecipada de app "embutida" no pagamento combinado do Bloco 1
-- (Pagar e Renovar): quando o cliente marca "incluir renovação deste app"
-- no alerta de app vencendo, o valor da licença é somado ao total cobrado
-- numa ÚNICA transação MP/Stripe, mas o log financeiro continua com DUAS
-- linhas em client_portal_payments — uma 'subscription' (o pagamento real,
-- com mp_payment_id do gateway) e uma 'app_renewal' "filha", criada só
-- depois de o pagamento combinado ser aprovado, dentro de runFulfillment
-- (ver lib/client-portal/fulfillment.ts). A filha nasce com
-- mp_payment_id = NULL (nunca existiu cobrança própria dela no gateway —
-- foi paga junto com a mãe) e parent_payment_id apontando pra mãe, só pra
-- rastreabilidade/auditoria.
--
-- bundled_app_renewals é o "contrato congelado" decidido no momento da
-- criação do pagamento (create-payment) — runFulfillment NUNCA recalcula
-- preço de app aqui, só lê esse snapshot e o replica pra(s) linha(s) filha.
-- Formato: [{ "client_app_id": "uuid", "app_name": "DupleCast",
--             "price_amount": 30.00, "price_currency": "BRL" }, ...]
--
-- Constraint de unicidade já verificada (24/08/2026, direto no Postgres):
-- client_portal_payments_uniq_ext é UNIQUE (tenant_id, gateway_type,
-- mp_payment_id) padrão, sem NULLS NOT DISTINCT — múltiplas linhas filhas
-- com mp_payment_id=NULL não colidem entre si nem com o índice parcial
-- uq_cpp_tenant_mp_payment (WHERE mp_payment_id IS NOT NULL).

ALTER TABLE client_portal_payments
  ADD COLUMN IF NOT EXISTS bundled_app_renewals jsonb,
  ADD COLUMN IF NOT EXISTS parent_payment_id uuid REFERENCES client_portal_payments(id) ON DELETE SET NULL;

COMMENT ON COLUMN client_portal_payments.bundled_app_renewals IS 'Snapshot congelado em create-payment (nunca recalculado no webhook): itens de renovação de app embutidos neste pagamento combinado. NULL/vazio = comportamento de hoje, sem nenhuma mudança. Só existe na linha "mãe" (payment_type=subscription).';
COMMENT ON COLUMN client_portal_payments.parent_payment_id IS 'Só preenchido na linha "filha" (payment_type=app_renewal) criada por runFulfillment a partir de bundled_app_renewals — aponta pra linha subscription que efetivamente foi cobrada no gateway. ON DELETE SET NULL: se a linha mãe for apagada, a filha (histórico financeiro) permanece.';

-- Suporta o upsert idempotente em runFulfillment (onConflict:
-- "parent_payment_id,client_app_id") — permite reprocessar a MESMA linha
-- mãe (ex: botão "Reprocessar" da Auditoria após uma falha no fulfillment
-- do plano) sem duplicar a linha filha. parent_payment_id é NULL em toda
-- linha que não é filha de bundle (a esmagadora maioria da tabela,
-- inclusive as linhas 'app_renewal' avulsas de apps/renew-payment/route.ts)
-- — Postgres nunca considera duas linhas com NULL em conflito num UNIQUE
-- index padrão, então essa constraint não interfere em nenhuma linha
-- existente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_portal_payments_parent_app
  ON client_portal_payments (parent_payment_id, client_app_id);
