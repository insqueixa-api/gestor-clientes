-- Otimização da página de Ações (app/admin/settings/condominio/page.tsx) —
-- pedido do Márcio, 24/08/2026: a página fazia duas idas ao banco em ONDAS
-- SEQUENCIAIS (uma dependendo da outra) toda vez que carregava:
--   1) busca a lista de condomínios do tenant
--   2) SÓ DEPOIS (esperando resolver qual condomínio fica selecionado,
--      olhando o localStorage) — busca as Ações daquele condomínio
-- E pior: ao clicar "Ver arquivadas", disparava uma 3ª consulta nova (com
-- eq(arquivada, ...) trocado), em vez de já ter os dois conjuntos em mão.
--
-- Fix: uma função só que devolve tudo num JSON — lista de condomínios +
-- TODAS as Ações (arquivadas e não-arquivadas juntas) do condomínio
-- resolvido — numa chamada só. O "qual condomínio fica selecionado" agora
-- é resolvido DENTRO da função (recebe um hint opcional do localStorage,
-- cai pro primeiro condomínio por nome se o hint não existir/for de outro
-- tenant), então o cliente já sabe de cara qual usar sem precisar de uma
-- ida a mais só pra decidir isso. Com isso: "Ver arquivadas" vira filtro
-- 100% client-side (zero rede), e o carregamento inicial da página cai de
-- 2 consultas sequenciais pra 1 chamada só.
--
-- Mesmo padrão de segurança do resto do projeto (ver
-- docs/sql/add_dashboard_bundle_rpcs.sql): SEM SECURITY DEFINER — roda com
-- o RLS do usuário logado, o CTE "tenant" só evita repetir o join em cada
-- subquery, não é ele quem garante o isolamento (isso continua sendo a
-- RLS das tabelas condominios/condominio_acoes).

CREATE OR REPLACE FUNCTION public.get_condominio_page_bundle(p_condominio_id_hint uuid DEFAULT NULL)
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
    'acoes', COALESCE((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC)
      FROM public.condominio_acoes a, resolved r
      WHERE a.condominio_id = r.id
    ), '[]'::jsonb)
  );
$function$;

-- Campo novo: preferência de como exibir o título da página (logo, nome,
-- ou os dois) — pedido do Márcio: a logo do Vidamérica já tem o nome
-- escrito nela, então "Logo + Condomínio" fica redundante; outro
-- condomínio pode ter só um símbolo/ícone na logo, aí faz sentido mostrar
-- os dois. Configurável por condomínio, não fixo pro sistema todo.
ALTER TABLE condominios ADD COLUMN IF NOT EXISTS titulo_pagina text NOT NULL DEFAULT 'logo_nome'
  CHECK (titulo_pagina IN ('logo_nome', 'logo', 'nome'));

COMMENT ON COLUMN condominios.titulo_pagina IS 'Como exibir o título da página de Ações desse condomínio: logo_nome (padrão, logo+nome), logo (só logo, cai pro nome se não tiver logo), nome (só o nome).';
