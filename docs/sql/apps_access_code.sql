-- "Código de acesso" estático de um app (ex: Brasil IPTV pede "Código: 4100"
-- pra logar, além de usuário/senha) — hoje só existia como texto solto,
-- hardcoded dentro de apps.portal_setup_instructions (ex: "Código: 4100 (se
-- der erro, tenta 4101 ou 4102)"). Pedido do Márcio, 31/07/2026: o
-- código/usuário/senha/DNS usados nas instruções precisam aparecer também
-- como campo copiável no portal (igual Device ID/MAC/Key), não só embutidos
-- no parágrafo — daí precisar virar uma coluna própria, com uma variável
-- {codigo} pra usar em apps.portal_setup_instructions (mesmo motor de
-- {usuario_app}/{senha_app}/{dns_servidor}, ver app/api/client-portal/apps/
-- list/route.ts).

ALTER TABLE apps ADD COLUMN IF NOT EXISTS access_code text;

COMMENT ON COLUMN apps.access_code IS 'Código de acesso estático do app (ex: "4100", "pfast") — usado pela variável {codigo} em portal_setup_instructions e exibido como campo copiável no portal.';
