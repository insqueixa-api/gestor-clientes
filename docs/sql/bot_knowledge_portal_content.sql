-- docs/sql/bot_knowledge_portal_content.sql
-- Permite reaproveitar bot_knowledge como fonte do FAQ / instruções de
-- "novo dispositivo" no portal do cliente (Bloco 3, sub-abas "Novo
-- dispositivo" e "Dúvidas e sugestões").
--
-- O `content` existente é escrito como instrução PRO BOT ("peça pro
-- cliente", "encaminhe pro Márcio") — não é texto pronto pra um cliente
-- ler. Por isso portal_visible sozinho não basta: só serve ao portal
-- quando também existir um portal_content (texto client-facing, escrito
-- à parte, curado manualmente no admin).

ALTER TABLE bot_knowledge
  ADD COLUMN IF NOT EXISTS portal_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portal_category text,
  ADD COLUMN IF NOT EXISTS portal_content text,
  ADD COLUMN IF NOT EXISTS portal_device_types text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN bot_knowledge.portal_visible IS
  'true = essa entrada pode aparecer no portal do cliente (ainda exige portal_content preenchido)';
COMMENT ON COLUMN bot_knowledge.portal_category IS
  'faq | device_setup — em qual sub-aba do Bloco 3 do portal essa entrada aparece';
COMMENT ON COLUMN bot_knowledge.portal_content IS
  'Texto client-facing, escrito à parte do content (que é instrução pro bot) — obrigatório pra aparecer no portal';
COMMENT ON COLUMN bot_knowledge.portal_device_types IS
  'Só quando portal_category = device_setup: SAMSUNG_LG, ANDROID_TVBOX, IOS, COMPUTADOR, FIRE_TV, ROKU';
