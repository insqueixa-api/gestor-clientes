-- docs/sql/bot_flow_settings_confirmed_not_notified.sql
-- 5º cenário de {confirmar_renovacao} (docs/sql/bot_flow_settings_confirmar_renovacao.sql
-- tinha só 4). Achado 08/08/2026 revisando checkRecentPortalPayment: quando
-- o envio automático da confirmação por WhatsApp falha, lib/client-portal/
-- fulfillment.ts agenda um retry via client_message_jobs (+2min) — mas esse
-- retry NUNCA atualiza client_portal_payments.whatsapp_status de volta pra
-- "sent". Resultado: fulfillment_status="done" (renovação JÁ aplicada com
-- sucesso) + whatsapp_status="error" (ou null) ficava caindo no bucket
-- "none" — o bot pedia comprovante de uma renovação que já estava 100%
-- concluída.
--
-- payment_confirmed_not_notified_message: novo status "confirmed_not_notified"
-- em PortalPaymentStatus (lib/whatsapp/bot-menu.ts), checado depois de
-- manual_pending/error e antes do fallback "none" (fulfillment_status =
-- "done" mas chegou até aqui = notificação não confirmada). Use
-- {primeiro_nome}, {data_vencimento} (mesmo tratamento de auto_confirmed).
--
-- NULL = usa o default hardcoded em lib/whatsapp/bot-flow-settings.ts.
ALTER TABLE public.bot_flow_settings
  ADD COLUMN IF NOT EXISTS payment_confirmed_not_notified_message text;
