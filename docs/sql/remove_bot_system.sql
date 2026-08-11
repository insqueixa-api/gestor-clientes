-- Remoção completa do sistema de atendimento automático (bot de árvore +
-- "Agent" de decisão + RAG com embeddings via Gemini). Decisão do Márcio
-- (10/08/2026): manter só as automações de cobrança/billing, sem nenhuma
-- resposta automática a clientes. O código correspondente já foi removido
-- do Next.js (app/api/whatsapp/bot/*, lib/whatsapp/bot-engine.ts,
-- bot-menu.ts, bot-flow-settings.ts, componentes BotMenuTreeEditor/
-- BotFlowCanvas/BotMonitorPanel) e da VM (whatsapp-service/src/
-- sessionManager.js não dispara mais handleBotLogic no recebimento de
-- mensagem). Este arquivo só limpa o que sobrou no banco.
--
-- Rode este arquivo direto no SQL Editor do Supabase quando estiver pronto.
--
-- NÃO mexe em: coupons (nenhuma linha, nenhuma coluna — inclusive
-- bot_visible fica, o Márcio vai reaproveitar RETENCAO7/15/30, BOASVINDAS,
-- FIDELIDADE1/3/5 no billing automático depois), client_message_jobs,
-- message_templates, client_events, chat_media.

-- ── RPCs de busca semântica (RAG) ────────────────────────────────────────
-- Se o Postgres reclamar de assinatura ambígua (mais de uma função com esse
-- nome), rode antes:
--   select proname, pg_get_function_identity_arguments(oid)
--   from pg_proc where proname in ('search_bot_knowledge', 'search_menu_intent');
-- e troque a linha correspondente abaixo por
-- "drop function if exists search_bot_knowledge(<argumentos exatos>);"
drop function if exists search_bot_knowledge;
drop function if exists search_menu_intent;

-- ── Tabelas exclusivas do bot (ordem: filhas antes das que elas referenciam) ─
drop table if exists public.bot_menu_steps;
drop table if exists public.bot_menu_nodes;
drop table if exists public.bot_flow_settings;
drop table if exists public.bot_conversation_state;
drop table if exists public.bot_knowledge;
