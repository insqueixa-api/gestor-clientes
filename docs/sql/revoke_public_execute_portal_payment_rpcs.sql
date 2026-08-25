-- Achado em auditoria de fraude/segurança (24/08/2026, pedido do Márcio de
-- validar "de ponta a ponta" o pagamento combinado): as 3 funções abaixo
-- são SECURITY DEFINER (rodam com privilégio total, ignoram RLS) e escrevem
-- direto em client_portal_payments, mas nenhuma delas tinha um REVOKE
-- explícito de PUBLIC — o Postgres concede EXECUTE a PUBLIC por padrão em
-- toda função nova, e isso nunca foi revogado. Na prática, qualquer um com
-- só a chave anon (pública, embutida no bundle do site) podia chamar essas
-- funções DIRETO via supabase-js, pulando 100% da validação de sessão/
-- posse que as rotas Next.js fazem (session_token, client_id pertence à
-- sessão, etc.) — descobri isso confirmando com has_function_privilege()
-- direto no Postgres, não é suposição.
--
-- Risco real por função (nenhuma delas deixa roubar dinheiro sozinha, mas
-- todas dão poder que ninguém de fora deveria ter):
--   - client_portal_try_acquire_fulfillment_lock: qualquer um podia
--     "sequestrar" o lock de fulfillment de QUALQUER pagamento de QUALQUER
--     tenant (bastava saber tenant_id+payment_id, ambos UUID) e travar a
--     renovação automática de um cliente de verdade brigando pelo lock.
--   - mark_app_renewal_manual_pending: qualquer um podia forçar
--     fulfillment_status='manual_pending' em qualquer pagamento de licença
--     de app de qualquer tenant, disparando a notificação (sino+email) de
--     "renovação pendente" à toa.
--   - portal_client_ids_for_identity: qualquer um podia enumerar quais
--     client_id pertencem a um whatsapp_username/telefone à força bruta —
--     não vaza dado sensível por si (só ids), mas facilita reconhecimento
--     pra tentar outros ataques.
--
-- Confirmei via grep no código-fonte inteiro que as 3 SÓ são chamadas
-- server-side, sempre com supabaseAdmin (service_role) — nenhuma rota usa
-- a chave anon/authenticated do browser pra chamar essas 3. Revogar de
-- PUBLIC não muda nenhum comportamento legítimo.
--
-- ⚠️ Isto cobre só as 3 funções tocadas pela feature de pagamento
-- combinado que estou validando agora. Uma varredura rápida mostrou o
-- MESMO padrão (EXECUTE ainda concedido a PUBLIC) em pelo menos mais ~15
-- funções da família "portal_*"/"*_fulfillment*" (login, PIN, tokens,
-- limpeza) — fora do escopo desta migração de propósito, porque algumas
-- delas PODEM ser chamadas direto do browser (ex: fluxo de login) e
-- revogar sem confirmar caso a caso quebraria o portal. Recomendo uma
-- auditoria dedicada só pra isso.

REVOKE EXECUTE ON FUNCTION public.client_portal_try_acquire_fulfillment_lock(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_portal_try_acquire_fulfillment_lock(uuid, uuid, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.mark_app_renewal_manual_pending(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_app_renewal_manual_pending(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.portal_client_ids_for_identity(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_client_ids_for_identity(uuid, text, text) TO service_role;
