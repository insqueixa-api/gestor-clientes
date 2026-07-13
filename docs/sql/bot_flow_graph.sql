-- ═══════════════════════════════════════════════════════════════════════════
-- Bot fluxo estilo n8n — ligações + mensagens globais reutilizáveis
-- Rode no SQL Editor do Supabase (uma vez). Seguro reexecutar (IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Mensagens globais do tenant (saudação, sucesso, escala, retry inválido)
CREATE TABLE IF NOT EXISTS public.bot_flow_settings (
  -- Sem FK rígida: evita falha se o nome da tabela de tenants divergir; o app filtra por tenant_id.
  tenant_id uuid PRIMARY KEY,
  greeting_message text,
  success_message text,
  escalate_message text,
  human_requested_message text,
  invalid_retry_message_1 text,
  invalid_retry_message_2 text,
  menu_invalid_intro_1 text,
  menu_invalid_intro_2 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bot_flow_settings IS
  'Mensagens reutilizáveis do bot (saudação, sucesso, escalonamento, retry). Editável no painel WhatsApp.';

-- 2) Ligações por nó (saídas do estilo n8n, sem canvas ainda)
-- redirect_to_node_id  → após executar a folha, entra nesse nó (várias entradas no destino)
-- on_resolved_target   → __success__ | __escalate__ | __end__ | uuid do nó | null
-- on_not_resolved_target → idem
-- ask_resolution       → força pergunta 1/2; null = auto (se closing/targets)
-- invalid_retry_*      → override local da 1ª/2ª resposta inválida neste menu

ALTER TABLE public.bot_menu_nodes
  ADD COLUMN IF NOT EXISTS redirect_to_node_id uuid REFERENCES public.bot_menu_nodes(id) ON DELETE SET NULL;

ALTER TABLE public.bot_menu_nodes
  ADD COLUMN IF NOT EXISTS on_resolved_target text;

ALTER TABLE public.bot_menu_nodes
  ADD COLUMN IF NOT EXISTS on_not_resolved_target text;

ALTER TABLE public.bot_menu_nodes
  ADD COLUMN IF NOT EXISTS ask_resolution boolean;

ALTER TABLE public.bot_menu_nodes
  ADD COLUMN IF NOT EXISTS invalid_retry_message_1 text;

ALTER TABLE public.bot_menu_nodes
  ADD COLUMN IF NOT EXISTS invalid_retry_message_2 text;

CREATE INDEX IF NOT EXISTS idx_bot_menu_nodes_redirect
  ON public.bot_menu_nodes (redirect_to_node_id)
  WHERE redirect_to_node_id IS NOT NULL;

-- 3) RLS (ajuste se o padrão do projeto for outro)
ALTER TABLE public.bot_flow_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bot_flow_settings' AND policyname = 'bot_flow_settings_service'
  ) THEN
    -- Service role (API com SUPABASE_SERVICE_ROLE_KEY) ignora RLS;
    -- policy permissiva só para authenticated do mesmo tenant, se usarem client browser direto.
    CREATE POLICY bot_flow_settings_tenant_select ON public.bot_flow_settings
      FOR SELECT TO authenticated
      USING (
        tenant_id IN (
          SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.user_id = auth.uid()
        )
      );
    CREATE POLICY bot_flow_settings_tenant_write ON public.bot_flow_settings
      FOR ALL TO authenticated
      USING (
        tenant_id IN (
          SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        tenant_id IN (
          SELECT tm.tenant_id FROM public.tenant_members tm WHERE tm.user_id = auth.uid()
        )
      );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'RLS policies bot_flow_settings: %', SQLERRM;
END $$;

-- 4) Verificação rápida (rode e me manda o JSON se quiser)
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name IN ('bot_flow_settings', 'bot_menu_nodes')
--   AND column_name IN (
--     'greeting_message','success_message','escalate_message','redirect_to_node_id',
--     'on_resolved_target','on_not_resolved_target','ask_resolution',
--     'invalid_retry_message_1','invalid_retry_message_2'
--   )
-- ORDER BY table_name, column_name;
