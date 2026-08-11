-- Remove a coluna coupons.bot_visible (introduzida em coupons_bot_visible.sql,
-- 19/07/2026) — existia só pra separar "cupons que o bot de atendimento
-- podia mencionar sozinho" dos demais. Com o bot removido por completo
-- (10/08/2026, ver docs/sql/remove_bot_system.sql), nada mais lê essa coluna:
-- findEligibleCoupon/getCouponPhraseForClient (usadas por envio_agora,
-- envio_programado e envio_simulado) nunca filtraram por ela, e a UI que
-- exibia/editava o campo (painel de cupons, página do cliente) já foi
-- limpa no código.
--
-- Rode este arquivo direto no SQL Editor do Supabase quando estiver pronto.

ALTER TABLE public.coupons DROP COLUMN IF EXISTS bot_visible;
