-- Achado (alinhamento de 07/08/2026, junto com a checagem de storage pedida
-- pelo Márcio depois do alerta do painel "249 MB / 500 MB"):
--
-- O job 'vacuum_catalog_weekly' (criado em reschedule_catalog_cleanup_and_vacuum.sql)
-- FALHOU as 2 únicas vezes que rodou (26/07 e 02/08), sempre com o mesmo erro:
--   "VACUUM cannot run inside a transaction block"
-- Motivo: quando o corpo de um cron.schedule tem mais de um comando SQL
-- separado por ';', o pg_cron executa tudo dentro de UMA transação — e
-- VACUUM (com ou sem FULL) não pode rodar dentro de transação nenhuma.
-- Resultado prático: desde que foi criado, esse job NUNCA rodou de verdade.
-- O espaço de linhas apagadas (órfãos do catálogo, que já são limpos todo
-- dia) fica marcado como "reutilizável" pelo autovacuum comum, mas nunca é
-- devolvido pro SO — só o VACUUM FULL faz isso, e ele nunca rodou.
--
-- Fix: 3 jobs separados (1 VACUUM por job), cada um roda sozinho na sua
-- própria transação implícita — forma suportada pelo pg_cron.

SELECT cron.unschedule('vacuum_catalog_weekly');

SELECT cron.schedule(
  'vacuum_catalog_episodes_weekly',
  '30 6 * * 0',
  $$ VACUUM (FULL, ANALYZE) public.catalog_episodes; $$
);

SELECT cron.schedule(
  'vacuum_catalog_master_weekly',
  '35 6 * * 0',
  $$ VACUUM (FULL, ANALYZE) public.catalog_master; $$
);

SELECT cron.schedule(
  'vacuum_catalog_availability_weekly',
  '40 6 * * 0',
  $$ VACUUM (FULL, ANALYZE) public.catalog_availability; $$
);

-- Achado 2 (índice 100% duplicado): catalog_master tem DOIS índices btree
-- na mesma coluna (titulo_normalizado) — um veio da constraint UNIQUE
-- (catalog_master_titulo_normalizado_key, obrigatório) e outro foi criado
-- solto por cima (idx_catalog_titulo, redundante). O índice da UNIQUE já
-- serve pra qualquer busca por igualdade/range nessa coluna sozinho — o
-- segundo só ocupa espaço (2.1 MB) e custa escrita extra em todo INSERT/
-- UPDATE de catalog_master, sem servir pra nada que o outro já não sirva.
DROP INDEX IF EXISTS public.idx_catalog_titulo;
