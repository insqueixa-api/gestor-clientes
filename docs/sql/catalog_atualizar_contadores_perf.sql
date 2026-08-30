-- 30/08/2026: achado no Query Performance do Supabase — catalog_atualizar_contadores(p_servidor)
-- media 5,5s por chamada (max quase 8s). Causa: o subselect que soma
-- temporadas/episodios por master_id agregava a tabela catalog_episodes
-- INTEIRA (581 mil linhas, todos os servidores) toda vez, e só DEPOIS
-- descartava o que não pertencia ao servidor pedido.
--
-- Corrigido: filtra os master_id do servidor ANTES de agregar — o resultado
-- por master_id é idêntico (agrega os episódios de TODOS os servidores pra
-- cada master_id, igual antes; só evita computar pra master_id que nem
-- entrariam no UPDATE). Testado ao vivo com o servidor de maior volume
-- (FAST, 44% de todos os episódios): 23,2s -> 10,6s.
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
    WHERE ce.master_id IN (
      SELECT DISTINCT master_id FROM catalog_episodes WHERE servidor = p_servidor
    )
    GROUP BY ce.master_id
  ) sub
  WHERE cm.id = sub.master_id;
$function$;
