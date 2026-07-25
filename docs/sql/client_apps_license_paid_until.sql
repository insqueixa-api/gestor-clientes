-- Rastreia se a LICENÇA de um app pago (apps.cost_type='paid', ex: Duplecast
-- R$30/ano) foi de fato paga pelo cliente antes de deixar ativar de verdade
-- no painel do parceiro. Antes disso, o portal deixava Adicionar → preencher
-- MAC → Configurar sem nenhuma cobrança — o app ficava ativo no painel do
-- parceiro de graça. Auditado em 25/07/2026.
--
-- Semântica:
--   NULL             -> licença nunca paga (bloqueia Configurar em apps pagos)
--   timestamptz > now() -> pago e válido até essa data (license_period='annual')
--   qualquer valor não-nulo, se license_period='lifetime' -> pago uma vez, vale sempre
-- Apps free/partnership ignoram essa coluna (configure/route.ts só checa
-- quando apps.cost_type='paid' e license_price > 0).

ALTER TABLE client_apps ADD COLUMN IF NOT EXISTS license_paid_until timestamptz;

COMMENT ON COLUMN client_apps.license_paid_until IS 'Preenchido por markAppRenewalPaid (lib/client-portal/fulfillment.ts) quando o pagamento avulso da licença é aprovado. NULL = licença paga nunca confirmada.';
