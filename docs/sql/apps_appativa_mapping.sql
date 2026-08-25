-- De-para entre o catálogo próprio (apps) e o catálogo da Appativa,
-- pedido do Márcio (25/08/2026): em vez de comparar nome a nome via CSV
-- exportado (achado: "tem confusões de nomes"), vincula direto no
-- cadastro do app o item correspondente do catálogo do parceiro. O "id"
-- salvo aqui é o mesmo campo que a Appativa espera em app_uuid nos
-- endpoints de Solicitação/Reenvio de Ativação (ver
-- project_appativa_integration na memória — apesar do nome do campo
-- deles, é o "id", não o "uuid").
--
-- appativa_app_name é um snapshot do nome no momento em que o Márcio
-- vinculou — só exibição/auditoria, nunca usado pra decidir nada (se a
-- Appativa renomear o app do lado deles, o vínculo por id continua
-- válido mesmo com o snapshot desatualizado).

ALTER TABLE apps
  ADD COLUMN IF NOT EXISTS appativa_app_id text,
  ADD COLUMN IF NOT EXISTS appativa_app_name text;

COMMENT ON COLUMN apps.appativa_app_id IS 'id do aplicativo correspondente no catálogo da Appativa (campo "id" de listar-aplicativos — é isso que vai em app_uuid nos endpoints de ativação deles, não o "uuid"). NULL = sem vínculo definido ainda.';
COMMENT ON COLUMN apps.appativa_app_name IS 'Snapshot do nome do app na Appativa no momento do vínculo — só exibição, nunca usado pra decidir nada.';
