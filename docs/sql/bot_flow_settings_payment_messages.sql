-- docs/sql/bot_flow_settings_payment_messages.sql
-- Promove as 3 mensagens do check_renovacao_recente ("Já paguei, aguardando
-- confirmação" e o gate antes de submenus) de constante hardcoded pra campo
-- editável em bot_flow_settings — mesmo padrão de coupon_found_intro/
-- coupon_not_found_message (docs/sql/bot_flow_settings_coupon_messages.sql).
--
-- Antes disso, só a mensagem de FALLBACK ("Pode me mandar o comprovante...",
-- texto do próprio nó) era visível/editável no admin. As outras 3 respostas
-- (pagamento já confirmado automaticamente / pendente de conclusão manual /
-- confirmado com falha técnica) ficavam invisíveis, hardcoded em
-- lib/whatsapp/bot-menu.ts — o Márcio não conseguia nem ler o que o bot
-- respondia em cada caso, muito menos editar.
--
-- payment_auto_confirmed_message: use {primeiro_nome} e {data_vencimento}
-- (esta última vira " Seu acesso está confirmado até {data}." quando há
-- data, ou some quando não há — nunca escrever a data fixa).
-- payment_manual_pending_message / payment_fulfillment_error_message: use
-- {primeiro_nome}.
--
-- NULL = usa o default hardcoded em lib/whatsapp/bot-flow-settings.ts.
ALTER TABLE public.bot_flow_settings
  ADD COLUMN IF NOT EXISTS payment_auto_confirmed_message text,
  ADD COLUMN IF NOT EXISTS payment_manual_pending_message text,
  ADD COLUMN IF NOT EXISTS payment_fulfillment_error_message text;
