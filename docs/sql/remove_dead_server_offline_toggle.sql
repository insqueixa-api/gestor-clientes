-- ============================================================================
-- Remove o botão ON/OFF de servidor (marcar como offline) e tudo que ele
-- alimentava — feature que só existia para avisar o bot de atendimento a
-- clientes sobre instabilidade de servidor. O bot foi removido por completo
-- em 10/08/2026 (ver memória do projeto: remoção do bot de atendimento);
-- essa era a última ponta solta que ainda restava no código/banco. Confirmado
-- por busca em todo o repositório: nenhum outro lugar lê/grava
-- is_offline/offline_since/offline_reason nem chama toggle_server_offline —
-- só a própria tela de Gerenciador de Servidor.
-- ============================================================================

-- 1) vw_servers_active não pode ter coluna removida via CREATE OR REPLACE
-- (Postgres não permite reduzir colunas de uma view existente) — precisa
-- dropar e recriar.
DROP VIEW IF EXISTS public.vw_servers_active;

CREATE VIEW public.vw_servers_active AS
 SELECT s.id,
    s.tenant_id,
    s.name,
    s.slug,
    s.notes,
    s.default_currency,
    s.credits_available,
    s.whatsapp_session,
    s.panel_type,
    s.panel_web_url,
    s.panel_telegram_group,
    s.panel_integration,
    s.dns,
    s.is_archived,
    s.created_at,
    s.updated_at,
    s.avg_credit_cost_brl,
    s.logo_url,
    si.integration_name AS panel_integration_name,
    si.provider AS panel_integration_provider,
    si.is_active AS panel_integration_active,
    s.avg_credit_cost_brl AS credit_unit_cost_brl
   FROM servers s
     LEFT JOIN server_integrations si ON si.id = s.panel_integration
  WHERE s.is_archived = false;

-- 2) RPC que só existia para gravar esses 3 campos
DROP FUNCTION IF EXISTS public.toggle_server_offline(uuid, boolean, timestamptz, text);

-- 3) Colunas mortas em servers
ALTER TABLE public.servers DROP COLUMN IF EXISTS is_offline;
ALTER TABLE public.servers DROP COLUMN IF EXISTS offline_since;
ALTER TABLE public.servers DROP COLUMN IF EXISTS offline_reason;
