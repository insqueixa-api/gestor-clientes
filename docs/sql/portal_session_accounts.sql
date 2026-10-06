-- ✅ 06/10/2026, auditoria de performance (pedido do Márcio): get-accounts
-- fazia sessão → portal_client_ids_for_identity em 2 idas sequenciais. Esta
-- função devolve a sessão válida + os ids das contas dela numa ida só (mesma
-- regra de identidade, reaproveitada). Sessão inválida/expirada → nenhuma
-- linha. Só service_role (rotas do portal).
create or replace function public.portal_session_accounts(p_session_token text)
returns table(tenant_id uuid, whatsapp_username text, client_ids uuid[])
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    s.tenant_id,
    s.whatsapp_username,
    coalesce(
      (select array_agg(x.id) from public.portal_client_ids_for_identity(s.tenant_id, s.whatsapp_username, s.phone_anchor) x),
      '{}'::uuid[]
    )
  from public.client_portal_sessions s
  where s.session_token = p_session_token
    and s.expires_at > now()
  limit 1;
$$;

revoke all on function public.portal_session_accounts(text) from public, anon, authenticated;
grant execute on function public.portal_session_accounts(text) to service_role;
