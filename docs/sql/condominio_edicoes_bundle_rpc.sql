-- Mesma otimização já aplicada em condominio_page_bundle_rpc.sql, agora
-- pra tela de Edições (app/admin/settings/condominio/edicoes/page.tsx):
-- ela buscava a lista de condomínios e SÓ DEPOIS (esperando resolver qual
-- ficou selecionado) buscava as edições daquele condomínio — duas idas
-- sequenciais. Vira uma chamada só, com o condomínio selecionado resolvido
-- dentro da própria função (hint do localStorage, cai pro primeiro por
-- nome se o hint não existir/for de outro tenant).
--
-- Mesmo padrão de segurança: SEM SECURITY DEFINER — roda com a RLS do
-- usuário logado; o CTE "tenant" só evita repetir o join, não é ele quem
-- garante o isolamento.

CREATE OR REPLACE FUNCTION public.get_condominio_edicoes_bundle(p_condominio_id_hint uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
  WITH tenant AS (
    SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.user_id = auth.uid() LIMIT 1
  ),
  conds AS (
    SELECT c.* FROM public.condominios c, tenant t WHERE c.tenant_id = t.tenant_id ORDER BY c.nome
  ),
  resolved AS (
    SELECT COALESCE(
      (SELECT id FROM conds WHERE id = p_condominio_id_hint),
      (SELECT id FROM conds ORDER BY nome LIMIT 1)
    ) AS id
  )
  SELECT jsonb_build_object(
    'condominios', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM conds c), '[]'::jsonb),
    'condominio_id', (SELECT id FROM resolved),
    'edicoes', COALESCE((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC)
      FROM public.condominio_edicoes e, resolved r
      WHERE e.condominio_id = r.id
    ), '[]'::jsonb)
  );
$function$;
