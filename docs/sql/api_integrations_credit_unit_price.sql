-- Achado pelo Márcio testando o catálogo (24/08/2026): o campo "valor" que
-- a Appativa devolve por aplicativo (listar-aplicativos) NÃO é preço em
-- R$ — é consumo de CRÉDITOS (ex: 0,6). O preço real em reais depende de
-- quanto o Márcio pagou por crédito na hora que abasteceu o saldo (varia
-- por faixa de compra, ex: R$12,10/crédito no lote de 30). Guarda esse
-- valor manualmente editável — o catálogo (appativa_catalog_modal.tsx)
-- multiplica créditos_consumidos * credit_unit_price pra mostrar o preço
-- real em R$ de cada app.

ALTER TABLE api_integrations
  ADD COLUMN IF NOT EXISTS credit_unit_price numeric;

COMMENT ON COLUMN api_integrations.credit_unit_price IS 'Preço em R$ de 1 crédito do parceiro (editado manualmente pelo Márcio, pode mudar conforme a faixa de compra) — usado pra converter "créditos consumidos por app" (retornado pela API deles) em preço real de cada aplicativo.';
