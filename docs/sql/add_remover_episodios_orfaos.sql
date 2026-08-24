-- catalog_episodes nunca teve limpeza própria — só catalog_availability
-- (via /api/catalogo/limpar) e catalog_master (via remover_master_orfaos()).
-- Um título que some do servidor perde a linha em catalog_availability, mas
-- os episódios continuavam acumulando pra sempre. Achado: 4.821 episódios
-- órfãos acumulados (4705 ELITE, 92 FAST, 24 NATV) antes desta correção.
--
-- Mesmo padrão de remover_master_orfaos(), mas por servidor (episódio de um
-- título ainda disponível no NATV não pode ser removido só porque saiu do
-- ELITE — cada (master_id, servidor) é independente).
-- ✅ Correção 24/08/2026: catalog_episodes não tem coluna `id` (chave
-- primária é composta: master_id+servidor+temporada+episodio) — o
-- `RETURNING ce.id` original nunca funcionou (erro 42703 "column ce.id
-- does not exist" toda vez que essa função rodava, silenciosamente
-- engolido por limparOrfaosAposSync). Efeito prático: desde que essa
-- função foi criada (24/07/2026), episódios órfãos nunca foram
-- realmente removidos pela limpeza automática pós-sync. RETURNING trocado
-- pra uma coluna que existe de verdade.
CREATE OR REPLACE FUNCTION public.remover_episodios_orfaos(p_servidor text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
AS $function$
  WITH deletados AS (
    DELETE FROM catalog_episodes ce
    WHERE ce.servidor = p_servidor
      AND NOT EXISTS (
        SELECT 1 FROM catalog_availability ca
        WHERE ca.master_id = ce.master_id AND ca.servidor = ce.servidor
      )
    RETURNING ce.master_id
  )
  SELECT count(*)::integer FROM deletados;
$function$;
