-- Nova categoria de integração (24/08/2026, pedido do Márcio): parceiros de
-- API que NÃO são "aplicativo" (robô que configura app no dispositivo do
-- cliente, tabela app_integrations) nem "servidor" (painel IPTV, tabela
-- server_integrations) — primeiro caso é a Appativa (appativa.store),
-- futuro provedor de pagamento/confirmação de licença de app.
--
-- Guarda email+senha (login do Márcio no painel do parceiro) E a própria
-- chave de API — ao contrário de outras chaves do projeto (TELEIN_API_KEY,
-- TMDB_API_KEY), esta fica no BANCO, não em variável de ambiente, porque o
-- parceiro pode trocar a chave a qualquer momento sem precisar de um novo
-- deploy — o código sempre lê a chave atual daqui na hora de usar.
--
-- Mesmo padrão de RLS de app_integrations (1 policy "tenant_isolation" só
-- pra ALL, escopada por tenant_members; service_role sempre ignora RLS).

CREATE TABLE IF NOT EXISTS api_integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  provider text not null,          -- 'APPATIVA' (mais parceiros no futuro)
  label text not null,             -- nome de identificação escolhido pelo Márcio
  login_email text,
  login_password text,
  api_key text,                    -- ✅ sempre lida daqui, nunca de env var — o parceiro pode rotacionar a qualquer momento
  api_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

COMMENT ON TABLE api_integrations IS 'Parceiros de API que não são "aplicativo" nem "servidor" (ex: Appativa) — credenciais de login + chave de API, sempre lida do banco (nunca de env var) porque pode rotacionar.';
COMMENT ON COLUMN api_integrations.api_key IS 'Chave de API atual do parceiro — pode mudar a qualquer momento no lado deles; o código sempre busca aqui na hora de chamar a API, nunca cacheia/hardcoda.';

ALTER TABLE api_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON api_integrations
  FOR ALL
  USING (tenant_id = (SELECT tenant_members.tenant_id FROM tenant_members WHERE tenant_members.user_id = auth.uid() LIMIT 1))
  WITH CHECK (tenant_id = (SELECT tenant_members.tenant_id FROM tenant_members WHERE tenant_members.user_id = auth.uid() LIMIT 1));
