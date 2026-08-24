-- Limpeza da feature de PIN do portal (removida) — 24/08/2026.
-- clients.portal_pin não existe mais em nenhuma tabela (confirmado via
-- information_schema.columns). Nenhuma rota do código chama essas duas
-- funções (confirmado via grep no repo inteiro) — só sobraram órfãs no
-- banco, referenciando internamente uma coluna que não existe mais.
-- Mesmo padrão de limpeza já feito antes no projeto (ver
-- project_saas_cleanup na memória: remoção de funções/triggers mortos).

DROP FUNCTION IF EXISTS public.portal_change_pin(p_session_token text, p_current_pin text, p_new_pin text);
DROP FUNCTION IF EXISTS public.portal_finalize_pin_reset(p_reset_token text, p_new_pin text);
