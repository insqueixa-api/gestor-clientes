-- Adiciona país da competição em jogos_dia, pra permitir ordenar a grade
-- de jogos com Brasil/Brasileirão-Série A no topo (pedido do Marcio,
-- 25/07/2026). A API do 365scores (webws.365scores.com) devolve um array
-- `competitions` separado com `countryId` por competição — não vinha
-- junto no objeto do jogo em si, por isso precisou de coluna nova.
ALTER TABLE public.jogos_dia
  ADD COLUMN IF NOT EXISTS pais_id integer,
  ADD COLUMN IF NOT EXISTS pais_nome text;
