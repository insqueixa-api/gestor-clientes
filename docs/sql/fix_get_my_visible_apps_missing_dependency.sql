-- get_my_visible_apps() chamava saas_my_tenant_id(), uma função que não
-- existe em NENHUM schema do banco (nem deveria — "saas_" não combina com
-- nenhuma outra convenção de nome usada aqui, é resíduo de algum boilerplate
-- usado pra bootstrapar o projeto). Toda chamada a get_my_visible_apps()
-- vinha falhando com "function saas_my_tenant_id() does not exist" — isso
-- quebrava silenciosamente 4 rotas: aplicativo/export, aplicativo/import,
-- cobranca/export e cobranca/import (todas usam essa RPC).
--
-- Em vez de recriar um helper com esse nome, resolve o tenant_id inline,
-- do mesmo jeito que todo o resto do banco já faz (ex.: a CTE "fx" das
-- views vw_dashboard_*): tenant_members + auth.uid().
CREATE OR REPLACE FUNCTION public.get_my_visible_apps()
 RETURNS SETOF apps
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_my_tenant_id uuid;
  v_superadmin_id uuid := 'a5ab0672-c845-4c40-96b9-eeed197e04ed';
BEGIN
  SELECT tenant_id INTO v_my_tenant_id
  FROM tenant_members
  WHERE user_id = auth.uid()
  LIMIT 1;

  -- Se for o Superadmin logado, retorna APENAS os apps dele (Os Globais)
  IF v_my_tenant_id = v_superadmin_id THEN
    RETURN QUERY SELECT * FROM apps WHERE tenant_id = v_my_tenant_id;
  ELSE
    -- Se for o Revendedor, ele recebe os Apps Dele (não ocultos)
    -- MAIS os Apps Globais que ele AINDA não customizou nem deletou
    RETURN QUERY
    SELECT * FROM apps
    WHERE tenant_id = v_my_tenant_id AND is_hidden = false
    UNION ALL
    SELECT * FROM apps
    WHERE tenant_id = v_superadmin_id
      AND id NOT IN (
        SELECT base_app_id FROM apps
        WHERE tenant_id = v_my_tenant_id AND base_app_id IS NOT NULL
      );
  END IF;
END;
$function$;
