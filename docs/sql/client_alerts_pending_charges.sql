-- Transforma client_alerts (antes só um alerta de texto livre, sem uso real)
-- num sistema de "pendência financeira": um alerta pode carregar um valor,
-- opcionalmente vinculado a um app específico do cliente, pra cobrar junto
-- da próxima renovação no portal.
--
-- amount + currency: guarda o valor "cru" na moeda em que foi lançado (ex:
-- 30 BRL, preço de licença de um app). A conversão pra moeda do cliente (se
-- ele paga em USD/EUR) acontece dinamicamente na hora de cobrar, usando
-- tenant_fx_rates — nunca fica um valor convertido "congelado" no banco.
--
-- client_app_id: vincula a pendência a um client_apps específico (pendência
-- de ativação de app). Null = pendência genérica ou alerta informativo puro.
-- ON DELETE SET NULL: se o app for removido do cliente depois, a pendência
-- financeira/histórico continua existindo, só perde o vínculo.
--
-- activation_date: quando o app/serviço foi de fato ativado — pode ser
-- diferente de quando o alerta foi criado (created_at), já que na prática
-- o alerta às vezes é lançado alguns dias depois da ativação real.
--
-- Aplicado em produção em 2026-07-18.

ALTER TABLE client_alerts
  ADD COLUMN IF NOT EXISTS amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS client_app_id uuid REFERENCES client_apps(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS activation_date date;

COMMENT ON COLUMN client_alerts.amount IS 'Valor da pendência financeira (null = alerta informativo puro, sem cobrança)';
COMMENT ON COLUMN client_alerts.currency IS 'Moeda em que o amount foi lançado — convertido dinamicamente na hora de cobrar se o cliente paga em outra moeda';
COMMENT ON COLUMN client_alerts.client_app_id IS 'App vinculado (pendência de ativação de app) — null para pendência genérica ou alerta informativo';
COMMENT ON COLUMN client_alerts.activation_date IS 'Data em que o app/serviço foi efetivamente ativado (pode ser anterior à criação do alerta)';
