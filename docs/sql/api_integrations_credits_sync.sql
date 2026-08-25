-- Suporta o "Sincronizar saldo" da aba Parceiros (24/08/2026) — mesmo
-- padrão já usado em servers.credits_available/credits_last_known, agora
-- pra parceiros de API (primeiro caso: créditos da Appativa). Guarda o
-- último saldo consultado via GET /api/creditos-disponiveis, pra exibir no
-- card e decidir quando disparar o alerta de saldo baixo (< 5 créditos,
-- limiar próprio — diferente do <=15 usado pros servidores IPTV).

ALTER TABLE api_integrations
  ADD COLUMN IF NOT EXISTS credits_available numeric,
  ADD COLUMN IF NOT EXISTS credits_last_sync_at timestamptz;

COMMENT ON COLUMN api_integrations.credits_available IS 'Último saldo de créditos conhecido do parceiro (sincronizado manualmente via botão, ou depois de cada ativação quando essa parte for implementada).';
COMMENT ON COLUMN api_integrations.credits_last_sync_at IS 'Quando credits_available foi atualizado pela última vez.';
