-- ✅ 07/09/2026, achado pelo Márcio: um pagamento FastFlow ficou "PENDENTE"
-- na Auditoria por horas, e ele lembrava de um "timer de 15min" no MP/
-- Stripe pra matar pendências velhas — não existe (nenhum gateway tem
-- timer próprio). A limpeza é 100% via cron.job
-- "cancel_expired_portal_payments" (função já cancela QUALQUER gateway
-- pendente há mais de 1h, sem distinção — isso já estava certo), mas o
-- cron só rodava 1x por dia (40 7 * * *) — um pagamento criado logo
-- depois das 7:40 só seria limpo quase 24h depois. Sobe a frequência pra
-- de 15 em 15 minutos, sem mexer na função em si.
SELECT cron.unschedule('cancel_expired_portal_payments');
SELECT cron.schedule(
  'cancel_expired_portal_payments',
  '*/15 * * * *',
  $$SELECT public.cancel_expired_portal_payments();$$
);
