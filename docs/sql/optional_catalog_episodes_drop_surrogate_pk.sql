-- OPCIONAL — mudança maior, não aplicada automaticamente. Ler antes de rodar.
--
-- catalog_episodes tem hoje DOIS índices únicos:
--   catalog_episodes_pkey                                  (id)                          17 MB, usado 2x desde sempre
--   catalog_episodes_master_id_servidor_temporada_episodio_key (master_id,servidor,temporada,episodio)  29 MB, usado 44 MILHÕES de vezes
--
-- Confirmei em todo o código (app/api/epg/sync-catalog/*, app/api/catalogo/*)
-- que NINGUÉM lê, filtra ou faz join usando catalog_episodes.id — toda
-- consulta, delete e o próprio upsert (onConflict: "master_id,servidor,
-- temporada,episodio") usa a chave composta. E nenhuma outra tabela tem FK
-- pra catalog_episodes.id (confirmado via information_schema).
--
-- Ou seja: a coluna "id" + seu índice pkey são puro peso morto — ~17 MB do
-- índice, mais a própria coluna uuid (16 bytes x 572 mil linhas). Trocar a
-- PK pra chave composta natural remove tudo isso sem mudar nenhum
-- comportamento do app.
--
-- Por que não apliquei junto com o resto: é uma mudança estrutural (some
-- uma coluna) numa tabela de 570 mil linhas — mais arriscada que os outros
-- fixes (que são só ajuste de permissão/índice duplicado/cron). Recomendo
-- rodar em horário de baixo uso e confirmar que os 3 syncs (elite/natv/fast)
-- continuam OK depois.

BEGIN;

-- catalog_episodes_master_id_servidor_temporada_episodio_key já pertence à
-- constraint UNIQUE (não é um índice solto), então não dá pra reaproveitar
-- via "PRIMARY KEY USING INDEX" (Postgres exige índice sem dono). Solução:
-- solta a UNIQUE (o índice dela some junto) e cria a PK direto nas mesmas
-- colunas — Postgres monta um índice novo equivalente pra ela.
ALTER TABLE public.catalog_episodes DROP CONSTRAINT catalog_episodes_pkey;
ALTER TABLE public.catalog_episodes DROP CONSTRAINT catalog_episodes_master_id_servidor_temporada_episodio_key;
ALTER TABLE public.catalog_episodes
  ADD CONSTRAINT catalog_episodes_pkey PRIMARY KEY (master_id, servidor, temporada, episodio);
ALTER TABLE public.catalog_episodes DROP COLUMN id;

COMMIT;

-- Depois de rodar, adicione ao próximo VACUUM FULL semanal (ou rode manual
-- uma vez) pra devolver o espaço físico:
-- VACUUM (FULL, ANALYZE) public.catalog_episodes;
