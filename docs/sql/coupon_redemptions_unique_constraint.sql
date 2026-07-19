-- Achado em auditoria de segurança (2026-07-19): a regra "1 uso de cupom
-- geral por conta" (client_id) só era garantida na aplicação (SELECT
-- "já usou?" seguido de INSERT em lib/client-portal/coupons.ts::
-- hasClientRedeemed) — não é atômico. Duas chamadas de create-payment em
-- paralelo pro mesmo cupom/cliente (ex: 2 abas, ou um script automatizado
-- chamando 2x rápido) podem AMBAS passar pela checagem "já usou?" antes de
-- qualquer uma gravar o resgate, gerando 2 payments com o mesmo cupom
-- aplicado — se ambos forem pagos, o cupom é usado 2x pelo mesmo cliente,
-- furando a regra de "1 uso" e o limite de max_total_redemptions de
-- campanhas limitadas.
--
-- Fix: constraint UNIQUE no banco, que é a fonte de verdade atômica —
-- fecha a corrida independente da checagem em nível de aplicação. Cupom
-- pessoal (coupon.client_id preenchido) já não usa essa regra "1 uso pra
-- sempre" mesmo assim (usa só is_active), então não é afetado por esta
-- constraint — ela só entra em jogo pra cupom GERAL, que é exatamente
-- onde hasClientRedeemed já impõe essa regra na aplicação.
--
-- Verificado antes de aplicar: 0 linhas duplicadas em coupon_redemptions
-- (coupon_id, client_id) na produção em 2026-07-19 — constraint aplica
-- sem conflito.

ALTER TABLE coupon_redemptions
  ADD CONSTRAINT coupon_redemptions_coupon_client_unique UNIQUE (coupon_id, client_id);
