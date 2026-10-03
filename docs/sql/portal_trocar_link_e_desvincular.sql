-- =====================================================================
-- 02/10/2026 — Menu "Portal" do cliente: trocar link mágico + desvincular
-- =====================================================================
-- Pedido do Márcio. Estados do cliente:
--   Ativo / Arquivado → aparecem no portal
--   Desvinculado      → NÃO aparece (= deep_archived_at preenchido; o cron
--                       de 61 dias já fazia isso sozinho, agora também tem
--                       manual em app/api/admin/clients/portal-access)
--
-- portal_rotate_token: o link mágico é da PESSOA (whatsapp/âncora de
-- telefone), não da conta. Desativa os tokens ativos daquele contato e
-- derruba as sessões abertas; o próximo portal_admin_create_token_for_
-- whatsapp_v2 (portal-access, mensagens automáticas) já gera um token novo.
-- Só service_role (rota do admin com requireAdminTenant).
create or replace function public.portal_rotate_token(
  p_tenant_id uuid,
  p_whatsapp text,
  p_phone_anchor text
)
returns table(tokens_desativados int, sessoes_encerradas int)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_whats text := public.normalize_phone(p_whatsapp);
  v_anchor text := nullif(public.normalize_phone(p_phone_anchor), '');
  v_tok int;
  v_ses int;
begin
  if coalesce(v_whats, '') = '' and v_anchor is null then
    raise exception 'whatsapp_required';
  end if;

  update public.client_portal_tokens t
     set is_active = false
   where t.tenant_id = p_tenant_id
     and coalesce(t.is_active, true) is true
     and (
       (v_whats <> '' and public.normalize_phone(t.whatsapp_username) = v_whats)
       or (v_anchor is not null and t.phone_anchor = v_anchor)
     );
  get diagnostics v_tok = row_count;

  delete from public.client_portal_sessions s
   where s.tenant_id = p_tenant_id
     and (
       (v_whats <> '' and public.normalize_phone(s.whatsapp_username) = v_whats)
       or (v_anchor is not null and s.phone_anchor = v_anchor)
     );
  get diagnostics v_ses = row_count;

  tokens_desativados := v_tok;
  sessoes_encerradas := v_ses;
  return next;
end $$;

revoke all on function public.portal_rotate_token(uuid, text, text) from public, anon, authenticated;
