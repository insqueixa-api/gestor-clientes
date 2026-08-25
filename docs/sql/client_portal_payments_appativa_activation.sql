-- Suporta a ativação automática de app via Appativa (25/08/2026) —
-- markAppRenewalPaid grava aqui o id da ativação retornado por
-- solicitar-ativacao/reenviar-ativacao, pra o webhook (app/api/webhooks/
-- appativa/route.ts) conseguir achar de volta o pagamento certo quando a
-- confirmação assíncrona chegar (payload deles usa "id_cobranca", que é
-- este mesmo id).

ALTER TABLE client_portal_payments
  ADD COLUMN IF NOT EXISTS appativa_historico_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_portal_payments_appativa_historico
  ON client_portal_payments (appativa_historico_id) WHERE appativa_historico_id IS NOT NULL;

COMMENT ON COLUMN client_portal_payments.appativa_historico_id IS 'id da ativação na Appativa (retornado por solicitar-ativacao/reenviar-ativacao) — usado pelo webhook deles para correlacionar o evento assíncrono de volta a este pagamento (payload do webhook chama esse mesmo valor de "id_cobranca").';
