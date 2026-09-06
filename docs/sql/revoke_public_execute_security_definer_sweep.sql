-- ✅ 06/09/2026 — auditoria de segurança completa (pagamento, autenticação,
-- RLS) pedida pelo Márcio depois de ver o painel "deepsec" da Vercel.
-- Achado CRÍTICO confirmado ao vivo no banco: has_function_privilege('anon',
-- oid, 'execute') = true para 81 funções SECURITY DEFINER (que ignoram RLS
-- por completo, rodam como 'postgres'), das quais 41 não tinham NENHUMA
-- checagem de auth.uid()/tenant_members por dentro.
--
-- O mais grave: `portal_admin_create_token_for_whatsapp_v2` só valida
-- `p_created_by` SE ele vier preenchido — chamando com p_created_by=null
-- (trivial via REST direto com a anon key pública) pula 100% da checagem e
-- gera um token de login válido pro whatsapp_username de QUALQUER cliente.
-- Combinado com `portal_start_session` (login real, só por token) e
-- `force_eternal_portal_tokens` (zera expiração de todos os tokens de uma
-- vez) isso formava uma cadeia completa de account takeover sem
-- autenticação nenhuma, bypassando inclusive o Turnstile da rota Next.js
-- (que só protege a rota, não o RPC direto no Postgres).
--
-- Confirmado por grep no código-fonte inteiro: todas as funções abaixo só
-- são chamadas server-side com supabaseAdmin (service_role) — nenhuma
-- rota usa a chave anon/authenticated do browser pra elas — OU são
-- chamadas só por pg_cron (que roda como superuser, ignora esses grants) OU
-- só por um trigger interno (idem) OU não têm NENHUM chamador em todo o
-- repositório (código morto/legado, ex: sistema de PIN — a rota de login
-- real usa só o token mágico, "PIN não é mais exigido no login").
-- Revogar de PUBLIC não muda nenhum comportamento legítimo em nenhum caso.
--
-- Algumas destas já tinham um arquivo de correção ESCRITO antes
-- (revoke_public_execute_portal_payment_rpcs.sql, admin_cron_dashboard.sql,
-- cron_health_watchdog.sql) mas o REVOKE nunca foi de fato aplicado no
-- banco (confirmado: has_function_privilege ainda retornava true pra elas)
-- — reaplicado aqui de novo, junto com os achados novos, num migration só.

-- ═══ GRUPO A — reaplicando fixes já escritos antes, nunca aplicados ═══
REVOKE EXECUTE ON FUNCTION public.client_portal_try_acquire_fulfillment_lock(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_try_acquire_fulfillment_lock(uuid, uuid, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.mark_app_renewal_manual_pending(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_app_renewal_manual_pending(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.portal_client_ids_for_identity(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_client_ids_for_identity(uuid, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_list_pgcron_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_pgcron_status() TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_cron_dashboard_raw() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cron_dashboard_raw() TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_cron_last_success(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_last_success(text) TO service_role;

-- ═══ GRUPO B — CRÍTICO: cadeia de account takeover do Portal ═══
-- Confirmado: só chamadas server-side (generatePortalLink em
-- lib/whatsapp/template-vars.ts via envio_agora/envio_programado/
-- envio_simulado, e app/api/admin/portal-preview/route.ts) — todas com
-- supabaseAdmin (service_role). portal_start_session: só
-- app/api/client-portal/login/route.ts (login real) e portal-preview
-- (preview do admin) — ambas service_role, NUNCA anon/authenticated direto.
REVOKE EXECUTE ON FUNCTION public.portal_admin_create_token_for_whatsapp_v2(uuid, text, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_admin_create_token_for_whatsapp_v2(uuid, text, uuid, text, timestamptz) TO service_role;

REVOKE EXECUTE ON FUNCTION public.portal_start_session(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_start_session(text, text) TO service_role;

-- Zero parâmetros, zera expiração de TODOS os tokens do portal de uma vez —
-- só deve rodar via pg_cron (job force_eternal_tokens_daily, roda como
-- superuser, ignora este REVOKE). Nenhum caller em app/lib/**.
REVOKE EXECUTE ON FUNCTION public.force_eternal_portal_tokens() FROM PUBLIC, anon, authenticated;

-- ═══ GRUPO C — código morto/legado (sistema de PIN, superado pelo login
-- só-por-token; zero chamador em todo o repositório) ═══
REVOKE EXECUTE ON FUNCTION public.get_saldo_conta(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_portal_pin(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_portal_credential(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_get_or_create_credentials(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_create_reset_token(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.portal_list_accounts(text) FROM PUBLIC, anon, authenticated;

-- ═══ GRUPO D — só chamada por trigger interno (trg_tenant_members_sync_
-- tenant, sempre com p_force=false) — nenhum chamador via RPC/app ═══
REVOKE EXECUTE ON FUNCTION public.sync_tenant_from_admin_member(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ═══ GRUPO E — cron-only (pg_cron roda como superuser, ignora este
-- REVOKE) ou service-role-only (confirmado via grep) ═══
REVOKE EXECUTE ON FUNCTION public.purge_due_clients(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_archive_expired_clients() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_purge_expired_clients() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_expired_portal_payments() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_overdue_transactions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.billing_dispatch_check() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.checar_sugestoes_adicionadas() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_message_jobs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_orphaned_portal_tokens() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_server_credits_from_integration() FROM PUBLIC, anon, authenticated;

-- Confirmado via grep: só chamadas server-side com supabaseAdmin
-- (app/api/epg/sync-catalog/*/route.ts e lib/catalogo/limpar-orfaos.ts).
REVOKE EXECUTE ON FUNCTION public.catalog_atualizar_contadores(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_atualizar_contadores(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.refresh_catalog_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_catalog_stats() TO service_role;

REVOKE EXECUTE ON FUNCTION public.remover_episodios_orfaos(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remover_episodios_orfaos(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.remover_master_orfaos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remover_master_orfaos() TO service_role;
