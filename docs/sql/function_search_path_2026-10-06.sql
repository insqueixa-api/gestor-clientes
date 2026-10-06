-- Security Advisor: "Function Search Path Mutable" — APLICADO 06/10/2026 (autorizado pelo Márcio)
-- search_path = public, extensions = mesmo padrão já em vigor no banco ("$user", public, extensions;
-- anon/authenticated/authenticator não têm search_path próprio). Comportamento não muda.
-- Todas as referências a auth/vault/cron dentro dessas funções já são qualificadas.
--
-- FORA de propósito (SET em função impede inlining → custo por linha):
--   is_tenant_allowed(uuid,uuid) — 29 políticas RLS
--   immutable_unaccent(text)     — índice idx_clients_search_trgm + busca de clientes
--   normalize_phone(text)        — coluna gerada + funções do portal
-- Essas 3 só usam pg_catalog ou public.* qualificado; aviso delas é aceitável.
--
-- Reverter uma: alter function public.<assinatura> reset search_path;

begin;
  alter function public._client_portal_payments_set_paid_at() set search_path = public, extensions;
  alter function public.apply_sale_to_server() set search_path = public, extensions;
  alter function public.apply_usage_to_server() set search_path = public, extensions;
  alter function public.approve_manual_payment(uuid,uuid) set search_path = public, extensions;
  alter function public.archive_client(uuid,uuid) set search_path = public, extensions;
  alter function public.archive_server(uuid,uuid,text) set search_path = public, extensions;
  alter function public.auto_archive_expired_clients() set search_path = public, extensions;
  alter function public.auto_purge_expired_clients() set search_path = public, extensions;
  alter function public.billing_claim_jobs(uuid,text,integer) set search_path = public, extensions;
  alter function public.billing_control_automation(uuid,uuid,text) set search_path = public, extensions;
  alter function public.billing_enqueue_now(uuid,uuid) set search_path = public, extensions;
  alter function public.billing_mark_failed(uuid,uuid,text) set search_path = public, extensions;
  alter function public.billing_mark_sent(uuid,uuid) set search_path = public, extensions;
  alter function public.billing_queue_set_scheduled_day() set search_path = public, extensions;
  alter function public.cancel_expired_portal_payments() set search_path = public, extensions;
  alter function public.cleanup_old_message_jobs() set search_path = public, extensions;
  alter function public.cleanup_old_notifications() set search_path = public, extensions;
  alter function public.cleanup_orphaned_portal_tokens() set search_path = public, extensions;
  alter function public.client_message_cancel(uuid,uuid) set search_path = public, extensions;
  alter function public.client_message_send_now(uuid,uuid,text,text) set search_path = public, extensions;
  alter function public.consume_server_credits(uuid,uuid,integer) set search_path = public, extensions;
  alter function public.debug_request_context() set search_path = public, extensions;
  alter function public.enforce_message_template_system_defaults() set search_path = public, extensions;
  alter function public.enforce_plan_table_system_defaults() set search_path = public, extensions;
  alter function public.ensure_default_plan_tables(uuid) set search_path = public, extensions;
  alter function public.fn_normalize_renewal_currency() set search_path = public, extensions;
  alter function public.force_eternal_portal_tokens() set search_path = public, extensions;
  alter function public.generate_portal_token(integer) set search_path = public, extensions;
  alter function public.get_client_detail_bundle(uuid) set search_path = public, extensions;
  alter function public.get_client_plan_periods(boolean) set search_path = public, extensions;
  alter function public.get_client_used_apps(boolean) set search_path = public, extensions;
  alter function public.get_clients_filter_facets(boolean,boolean) set search_path = public, extensions;
  alter function public.get_clients_list_page(boolean,text,text,uuid,text,text,text,text,text,boolean,integer,integer,boolean) set search_path = public, extensions;
  alter function public.get_condominio_edicoes_bundle(uuid) set search_path = public, extensions;
  alter function public.get_condominio_page_bundle(uuid) set search_path = public, extensions;
  alter function public.get_dashboard_finance_bundle() set search_path = public, extensions;
  alter function public.get_dashboard_iptv_bundle() set search_path = public, extensions;
  alter function public.get_fin_saldos_contas() set search_path = public, extensions;
  alter function public.get_last_reseller_sale(uuid,uuid) set search_path = public, extensions;
  alter function public.get_trial_plan_periods(boolean) set search_path = public, extensions;
  alter function public.get_trial_used_apps(boolean) set search_path = public, extensions;
  alter function public.get_trials_list_page(boolean,text,text,uuid,text,text,text,text,text,integer,integer) set search_path = public, extensions;
  alter function public.handle_new_user() set search_path = public, extensions;
  alter function public.log_client_archive_restore_event() set search_path = public, extensions;
  alter function public.log_server_credit_purchase_only(uuid,uuid,numeric,numeric,currency_code,numeric,numeric,text) set search_path = public, extensions;
  alter function public.log_trial_conversion_event() set search_path = public, extensions;
  alter function public.log_trial_created_event() set search_path = public, extensions;
  alter function public.make_unique_tenant_slug(text,uuid) set search_path = public, extensions;
  alter function public.migrate_client_server(uuid,uuid,uuid,text) set search_path = public, extensions;
  alter function public.normalize_phone_digits(text) set search_path = public, extensions;
  alter function public.prevent_apps_tenant_id_change() set search_path = public, extensions;
  alter function public.purge_archived_clients() set search_path = public, extensions;
  alter function public.restore_client(uuid,uuid) set search_path = public, extensions;
  alter function public.restore_server(uuid,uuid,text) set search_path = public, extensions;
  alter function public.sell_credits_to_reseller_and_log(uuid,uuid,uuid,numeric,numeric,currency_code,numeric,text) set search_path = public, extensions;
  alter function public.sell_credits_to_reseller_without_balance(uuid,uuid,uuid,numeric,numeric,currency_code,numeric,text) set search_path = public, extensions;
  alter function public.set_updated_at() set search_path = public, extensions;
  alter function public.slugify(text) set search_path = public, extensions;
  alter function public.sync_server_credits_from_integration() set search_path = public, extensions;
  alter function public.tg_set_updated_at() set search_path = public, extensions;
  alter function public.topup_server_credits_and_log(uuid,uuid,numeric,numeric,currency_code,numeric,numeric,text) set search_path = public, extensions;
  alter function public.unaccent_immutable(text) set search_path = public, extensions;
  alter function public.update_updated_at() set search_path = public, extensions;
  alter function public.update_whatsapp_status(uuid,uuid,text) set search_path = public, extensions;
  alter function public.validate_apps_partner_server_same_tenant() set search_path = public, extensions;
commit;
