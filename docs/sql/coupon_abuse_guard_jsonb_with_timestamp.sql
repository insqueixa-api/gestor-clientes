-- Corrige 2 bugs do rate limit anti-abuso de cupom (achados pelo Marcio
-- testando o portal, 24/08/2026):
--
-- 1) codes_tried não tinha janela de tempo nenhuma — só zerava quando um
--    bloqueio anterior EXPIRAVA. Um código de teste digitado semanas atrás
--    continuava contando pra sempre até acidentalmente somar 5 com
--    tentativas de dias completamente diferentes. Corrigido: cada
--    tentativa agora carrega um timestamp e só conta se caiu nas últimas
--    24h (ver pruneRecentAttempts em lib/client-portal/coupons.ts) — por
--    isso a coluna precisa virar jsonb (array de objetos {code, at}),
--    não dá mais pra ser text[] (só strings, sem onde guardar o
--    timestamp).
--
-- 2) Contava tentativa VÁLIDA também — um cupom aplicado com sucesso
--    "gastava" uma das 5 tentativas à toa. Corrigido no código
--    (recordFailedCouponAttempt só é chamada quando o código JÁ falhou de
--    verdade); não precisa de mudança de schema pra esse ponto.
--
-- USING to_jsonb(codes_tried) converte as linhas existentes (array de
-- strings, sem timestamp) pro novo formato — o código já trata entrada
-- sem "at" como expirada de propósito (pruneRecentAttempts), então essas
-- linhas antigas simplesmente começam do zero sob a regra nova, sem
-- precisar de nenhum backfill de data.

ALTER TABLE coupon_abuse_guard
  ALTER COLUMN codes_tried TYPE jsonb USING to_jsonb(codes_tried),
  ALTER COLUMN codes_tried SET DEFAULT '[]'::jsonb;

COMMENT ON COLUMN coupon_abuse_guard.codes_tried IS 'Array jsonb de {code, at} — só tentativas de código que FALHARAM (nunca as válidas), só as caídas dentro da janela rolante de 24h contam pro limite. Ver lib/client-portal/coupons.ts::pruneRecentAttempts/recordFailedCouponAttempt.';
