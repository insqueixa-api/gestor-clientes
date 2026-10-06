-- ✅ 06/10/2026, auditoria de performance (pedido do Márcio): TODA rota do
-- portal validava a sessão em 2 idas ao banco em sequência (sessão →
-- portal_client_ids_for_identity → confere se o client_id está na lista).
-- Esta função faz as duas coisas numa ida só, com a MESMA regra de
-- identidade (reaproveita portal_client_ids_for_identity, nada duplicado).
-- Sessão expirada, token desconhecido ou conta que não pertence à sessão →
-- nenhuma linha (o chamador trata como 401, igual antes).
-- Só service_role (chamada pelas rotas do portal, nunca pelo navegador).
create or replace function public.portal_validate_client(p_session_token text, p_client_id uuid)
returns table(tenant_id uuid, whatsapp_username text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.tenant_id, s.whatsapp_username
  from public.client_portal_sessions s
  where s.session_token = p_session_token
    and s.expires_at > now()
    and exists (
      select 1
      from public.portal_client_ids_for_identity(s.tenant_id, s.whatsapp_username, s.phone_anchor) x
      where x.id = p_client_id
    )
  limit 1;
$$;

revoke all on function public.portal_validate_client(text, uuid) from public, anon, authenticated;
grant execute on function public.portal_validate_client(text, uuid) to service_role;
