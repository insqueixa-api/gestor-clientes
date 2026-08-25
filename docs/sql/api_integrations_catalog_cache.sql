-- Achado pelo Márcio testando o modal "Aplicativos disponíveis" (25/08/2026):
-- abrir o modal não precisa bater na API deles toda vez — só quando o
-- usuário clicar em "Sincronizar" de propósito. Guarda o último catálogo
-- buscado (snapshot completo) e quando foi buscado, pra abrir o modal
-- instantâneo lendo daqui; o botão Sincronizar é que dispara a busca ao
-- vivo e atualiza este cache.

ALTER TABLE api_integrations
  ADD COLUMN IF NOT EXISTS catalog_cache jsonb,
  ADD COLUMN IF NOT EXISTS catalog_last_sync_at timestamptz;

COMMENT ON COLUMN api_integrations.catalog_cache IS 'Snapshot do catálogo de aplicativos do parceiro (array de {id, uuid, nome, valor}), atualizado só quando o botão "Sincronizar" é clicado — abrir o modal não sincroniza sozinho.';
COMMENT ON COLUMN api_integrations.catalog_last_sync_at IS 'Quando catalog_cache foi atualizado pela última vez.';
