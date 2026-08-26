-- Guarda os últimos valores digitados no modal "Nova Recarga" (Appativa/
-- Duplecast) — achado 26/08/2026, pedido do Márcio: o modal sempre abria
-- zerado, sem lembrar qtd/valor/moeda/meio de pagamento da recarga
-- anterior, obrigando a redigitar tudo toda vez (ex: Duplecast é sempre
-- "10 códigos por 25 USD via PIX").
--
-- jsonb solto (não colunas dedicadas) de propósito — é só conveniência de
-- preenchimento do formulário, não dado de negócio consultável/reportável
-- (isso já vive em fin_transacoes.observacoes + valor).
ALTER TABLE api_integrations
  ADD COLUMN IF NOT EXISTS last_recharge_meta jsonb;
