-- docs/sql/bot_flow_settings_coupon_messages.sql
-- Promove as 2 mensagens do fluxo de cupom do bot ({cupom_frase}) de
-- constante hardcoded pra campo editável em bot_flow_settings, no mesmo
-- padrão de greeting_message/success_message/escalate_message etc.
--
-- coupon_found_intro: abertura usada SÓ quando o cliente tem cupom
-- elegível (ex: "Boa notícia, {primeiro_nome}! 🎉 Encontrei um cupom
-- disponível pra você:") — vem antes do texto do cupom em si.
-- coupon_not_found_message: resposta de {cupom_frase} quando não há
-- nenhum cupom bot-visible elegível — sozinha, sem introdução.
--
-- NULL = usa o default hardcoded em lib/whatsapp/bot-flow-settings.ts
-- (mesmo comportamento de fallback de todo o resto da tabela).
ALTER TABLE public.bot_flow_settings
  ADD COLUMN IF NOT EXISTS coupon_found_intro text,
  ADD COLUMN IF NOT EXISTS coupon_not_found_message text;
