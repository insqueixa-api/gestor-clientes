-- ✅ 05/09/2026: notify.ts ganhou 2 tipos novos (whatsapp_hard_reset,
-- whatsapp_erros_sessao, ver app/api/whatsapp/session-alert/route.ts) mas
-- a UNION do TypeScript não tem efeito nenhum na constraint real do banco
-- -- sem isso, todo insert falhava silenciosamente (notify() só loga o
-- erro, nunca lança), então a rota respondia {ok:true} sem gravar nada.
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'fin_vencido'::text,
    'transfer_aguardando'::text,
    'manual_pending'::text,
    'whatsapp_falha'::text,
    'whatsapp_desconectado'::text,
    'whatsapp_hard_reset'::text,
    'whatsapp_erros_sessao'::text,
    'automacao_falha'::text,
    'saldo_baixo'::text,
    'sugestao_conteudo'::text,
    'app_setup_pending'::text,
    'app_removal_pending'::text,
    'fulfillment_error'::text,
    'cron_falha'::text
  ]));
