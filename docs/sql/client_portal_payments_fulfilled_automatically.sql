-- ✅ 07/09/2026, achado pelo Márcio: a Auditoria mostra "CONCLUÍDO (MANUAL)"
-- pra QUALQUER pagamento de app_renewal com fulfillment_status='manual_done'
-- — mas esse status também é gravado pelas renovações 100% automáticas
-- (Appativa, Duplecast, GerenciaApp/GPC Roku), que nunca passaram pela mão
-- de ninguém. "manual_done" é só o nome legado do status (era tudo manual
-- quando o campo nasceu); não dava pra saber, só olhando o banco, se um
-- pagamento específico foi concluído pelo sistema sozinho ou por um clique
-- real do admin no botão "Concluir" da Auditoria.
ALTER TABLE client_portal_payments
  ADD COLUMN IF NOT EXISTS fulfilled_automatically boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN client_portal_payments.fulfilled_automatically IS
  'true = concluído sozinho por uma integração automática (Appativa/Duplecast/GerenciaApp/GPC Roku), sem clique nenhum do admin. false (padrão) = clique manual real em "Concluir" na Auditoria, ou renovação de assinatura (não é app_renewal).';
