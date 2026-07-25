-- Extensão de client_app_requests pra cobrir também pedido de REMOÇÃO (não
-- só configuração inicial) + coluna de instruções curadas por app pra
-- página de detalhe /renew-beta/apps/[id].
--
-- Contexto: cliente pode excluir um app sem integração automática pelo
-- portal — como não dá pra desconfigurar sozinho no painel do parceiro, o
-- pedido cai pro admin (mesma fila de "Aplicativos" da Auditoria, só que
-- com action='removal'). Ao concluir esse tipo de pedido, o admin não só
-- marca "feito" — a linha em client_apps é DE FATO apagada nesse momento
-- (fica pendente na tela do cliente até lá, com um aviso de "exclusão
-- solicitada").

ALTER TABLE client_app_requests
  ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'setup' CHECK (action IN ('setup','removal'));

COMMENT ON COLUMN client_app_requests.action IS 'setup = cliente pediu ajuda pra configurar; removal = cliente pediu pra excluir um app sem integração (admin desconfigura por fora e conclui, o que dispara o delete real de client_apps).';

-- notifications.type ganha o tipo novo (setup já tinha entrado numa
-- migration anterior neste mesmo dia).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'fin_vencido','transfer_aguardando','manual_pending','whatsapp_falha',
    'automacao_falha','saldo_baixo','sugestao_conteudo','app_setup_pending',
    'app_removal_pending'
  ]));

-- Instruções curadas por app (texto livre, editado pelo admin no catálogo
-- de aplicativos) — mostradas na página de detalhe do app no portal.
ALTER TABLE apps ADD COLUMN IF NOT EXISTS portal_setup_instructions text;
COMMENT ON COLUMN apps.portal_setup_instructions IS 'Passo a passo específico desse app, escrito pelo admin, mostrado pro cliente na página de detalhe do app no portal (/renew-beta/apps/[id]). Null/vazio = seção não aparece.';

-- Aplicado em produção em 2026-07-25.
