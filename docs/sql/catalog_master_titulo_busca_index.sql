-- Achado no pg_stat_statements (24/08/2026): `.in("titulo_busca", buscaKeys)`
-- usado nos syncs de catálogo (app/api/epg/sync-catalog/elite e /natv, pra
-- checar títulos já existentes antes de inserir/atualizar) tinha média de
-- 726ms em 6.496 chamadas — muito mais lento que o padrão irmão
-- `.in("titulo_normalizado", ...)`, que roda em 3,7ms.
--
-- Causa: catalog_master.titulo_busca só tinha um índice GIN de trigrama
-- (idx_catalog_master_titulo_busca, feito pra ILIKE '%...%' em
-- app/api/catalogo/busca), que NÃO acelera um lookup de igualdade/array como
-- `= ANY(...)` — cada chamada varria a tabela inteira (34 mil linhas) sem
-- aproveitar índice nenhum. titulo_normalizado tem índice btree único e por
-- isso o mesmo padrão de query nele é 200x mais rápido.
--
-- Fix: índice btree comum (NÃO único) em titulo_busca — não pode ser único
-- porque o mesmo título de busca pode repetir entre tipos diferentes (filme
-- vs série), como o próprio código já assume (dedup por
-- `${titulo_busca}|${tipo}` em memória, não no banco). Convive sem conflito
-- com o índice GIN existente — cada um serve um padrão de busca diferente.

CREATE INDEX IF NOT EXISTS idx_catalog_master_titulo_busca_btree
  ON public.catalog_master USING btree (titulo_busca);
