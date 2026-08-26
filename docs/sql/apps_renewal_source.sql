-- Escolha entre Duplecast/Appativa quando o mesmo app catálogo está mapeado
-- nos dois (achado 26/08/2026, pedido do Márcio: "caso meus créditos do
-- Duplecast acabem, posso decidir manter o deles [Appativa]"). Só é lido/
-- exibido quando apps.integration_type='DUPLECAST' E apps.appativa_app_id
-- também está preenchido — nesse caso, 'appativa' força a renovação
-- automática (lib/client-portal/fulfillment.ts, markAppRenewalPaid) a usar
-- a Appativa em vez do Duplecast; qualquer outro valor (incl. null) mantém
-- o Duplecast, que é o padrão. Nunca afeta apps sem os dois mapeados ao
-- mesmo tempo.
ALTER TABLE apps
  ADD COLUMN IF NOT EXISTS renewal_source text;
