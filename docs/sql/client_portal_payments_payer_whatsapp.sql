-- 17/09/2026, pedido do Márcio: cada cliente (titular OU contato
-- secundário) tem seu próprio link mágico pro Portal e pode pagar por lá —
-- mas o Log do Portal (Auditoria) sempre mostrava o nome do TITULAR, mesmo
-- quando quem logou e pagou foi o secundário. A coluna `session_token` já
-- existente em client_portal_payments nunca é preenchida em nenhum insert
-- real do código (achado ao investigar: 0 linhas com session_token não-nulo
-- em toda a tabela) — em vez de reaproveitá-la, esta coluna nova grava
-- diretamente o whatsapp_username de quem de fato autenticou no Portal e
-- iniciou o pagamento (sess.whatsapp_username, já disponível em toda rota
-- de criação de pagamento via validatePortalClient/portal_start_session).
-- NULL em renovações manuais feitas pelo admin (comportamento correto,
-- pedido explícito do Márcio: manter o titular nesses casos).
ALTER TABLE public.client_portal_payments
  ADD COLUMN IF NOT EXISTS payer_whatsapp_username text;

COMMENT ON COLUMN public.client_portal_payments.payer_whatsapp_username IS
  'whatsapp_username de quem autenticou no Portal e pagou (titular ou contato secundário). NULL = renovação manual pelo admin ou pagamento anterior a 17/09/2026.';
