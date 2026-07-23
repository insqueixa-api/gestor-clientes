-- Supabase Advisor: "Security Definer View" (CRITICAL) em 7 views.
--
-- Views no Postgres, por padrão, rodam com os privilégios do DONO da view
-- (aqui, "postgres" — um superusuário), não de quem está consultando. Isso
-- faz a view IGNORAR completamente o RLS das tabelas de origem.
--
-- Achado crítico e ATIVO: vw_epg_config expõe client.server_username e
-- client.server_password (senha de painel dos clientes) SEM nenhum filtro de
-- tenant — e o grant de SELECT nela inclui o role "anon" (visitante não
-- autenticado). Ou seja, hoje, qualquer pessoa com a URL pública do projeto
-- Supabase + a anon key (que é pública por design, embutida no site) consegue
-- ler usuário/senha de TODOS os clientes de TODOS os tenants via
-- GET /rest/v1/vw_epg_config, sem fazer login.
--
-- vw_servers_active/vw_servers_archived têm o mesmo problema (expõem
-- servidores de QUALQUER tenant pra qualquer authenticated, e pra anon
-- também) — hoje só não vaza pior porque o código do app sempre acrescenta
-- .eq("tenant_id", ...) na consulta, mas isso é só o app se comportando bem,
-- não é uma trava de verdade — qualquer chamada direta à API (fora do app)
-- ignora esse filtro.
--
-- As 4 views de catálogo (vw_catalog_*) leem de tabelas SEM tenant_id (é
-- conteúdo compartilhado/global de propósito), mas mesmo assim rodam com
-- security_invoker=false hoje, o que ignora até o RLS "deny all" que already
-- protege as tabelas base. Confirmei que todo o código do app usa a
-- service-role key pra ler essas views (nenhum uso via anon/authenticated
-- encontrado) — então essa correção não quebra nada em uso, só fecha o
-- acesso direto indevido.
--
-- Fix padrão recomendado pelo próprio Supabase: security_invoker=true faz a
-- view rodar com os privilégios de QUEM CONSULTA, então o RLS das tabelas de
-- origem passa a valer de verdade. service_role continua funcionando igual
-- (sempre ignora RLS, independente dessa opção).

ALTER VIEW public.vw_servers_active     SET (security_invoker = true);
ALTER VIEW public.vw_servers_archived   SET (security_invoker = true);
ALTER VIEW public.vw_epg_config         SET (security_invoker = true);
ALTER VIEW public.vw_catalog_categorias SET (security_invoker = true);
ALTER VIEW public.vw_catalog_novidades  SET (security_invoker = true);
ALTER VIEW public.vw_catalog_full       SET (security_invoker = true);
ALTER VIEW public.vw_catalog_sem_tmdb   SET (security_invoker = true);
