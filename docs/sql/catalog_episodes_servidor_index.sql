-- 30/08/2026: achado no Query Performance do Supabase — SELECT * FROM
-- catalog_episodes WHERE servidor = $1 (sem master_id) fazia varredura
-- completa das ~580 mil linhas (media 2,6s, ate 7,8s) porque so existia o
-- indice composto da PK (master_id, servidor, temporada, episodio), que nao
-- ajuda quando so o servidor e conhecido.
--
-- CONCURRENTLY: nao trava leitura/escrita na tabela enquanto cria (levou
-- ~1,6s numa tabela de 580k linhas). Confirmado via EXPLAIN que o planner
-- passou a usar Index Scan em vez de Seq Scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_catalog_episodes_servidor
  ON public.catalog_episodes (servidor);
