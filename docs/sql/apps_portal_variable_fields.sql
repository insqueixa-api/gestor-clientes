-- Separa duas coisas que antes estavam acopladas (pedido do Márcio,
-- 31/07/2026, depois de ver o resultado feio de {codigo}/{usuario_app}/
-- {senha_app} aparecendo tanto escrito por extenso no parágrafo de
-- instruções QUANTO repetido de novo como badge logo abaixo):
--   1) portal_setup_instructions — texto livre, continua podendo usar as
--      tags {codigo}/{usuario_app}/{senha_app}/{dns_servidor}/{m3u_url} pra
--      substituição inline (app/admin/gerenciador/aplicativo/page.tsx,
--      toolbar "Inserir na instrução").
--   2) portal_variable_fields — ARRAY explícito de quais dessas variáveis
--      (por chave: "codigo"/"usuario_app"/"senha_app"/"dns_servidor")
--      também devem virar badge copiável no portal — independente de estar
--      ou não mencionada no texto. Antes isso era inferido automaticamente
--      (badge aparecia se o token estivesse no texto), o que forçava
--      duplicar a mesma informação escrita + badge. Agora é uma escolha
--      separada do admin.

ALTER TABLE apps ADD COLUMN IF NOT EXISTS portal_variable_fields text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN apps.portal_variable_fields IS 'Chaves de variável (codigo/usuario_app/senha_app/dns_servidor) que devem aparecer como badge copiável no portal, independente do texto de portal_setup_instructions.';
