-- catalog_atualizar_contadores(p_servidor) não existe mais no banco. As 3
-- rotas de sync (elite, natv, fast) chamam essa RPC identicamente no fim de
-- cada sincronização pra atualizar catalog_master.total_temporadas /
-- total_episodios — como a função sumiu, os 3 servidores vinham falhando
-- igualmente (silencioso: só um console.error, sync continua normal).
-- Confirmado: toda série no catálogo está com os dois contadores zerados,
-- mesmo tendo episódios de verdade.
--
-- catalog_master é uma linha só por título (compartilhada entre os
-- servidores que o oferecem — catalog_availability é que é por servidor).
-- Recalcula usando TODOS os episódios do título (soma de todos os
-- servidores), não só do p_servidor que disparou a chamada — assim o
-- resultado não depende de qual servidor sincronizou por último.
CREATE OR REPLACE FUNCTION public.catalog_atualizar_contadores(p_servidor text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $function$
  UPDATE catalog_master cm
  SET total_temporadas = sub.temporadas,
      total_episodios = sub.episodios
  FROM (
    SELECT ce.master_id, count(DISTINCT ce.temporada) AS temporadas, count(*) AS episodios
    FROM catalog_episodes ce
    GROUP BY ce.master_id
  ) sub
  WHERE cm.id = sub.master_id
    AND cm.id IN (
      SELECT DISTINCT master_id FROM catalog_episodes WHERE servidor = p_servidor
    );
$function$;
