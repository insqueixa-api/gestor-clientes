-- ✅ 05/10/2026, pedido do Márcio: virou cliente pagante = sai do Papa Testes
-- (antes ficava marcado "Convertido" = falso positivo). Pela PESSOA: todos os
-- testes dela (qualquer servidor/usuário), casando por WhatsApp, usuário ou
-- últimos 8 dígitos do telefone (formatos salvos diferentes, ex:
-- "15991015697" x "+555991015697"). Chamada pelo update_client (admin) e
-- pelo fulfillment do portal. Devolve quantos registros saíram.
create or replace function public.papa_testes_remove_for_client(p_tenant_id uuid, p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- chamada do navegador (admin logado): só no próprio tenant
  if auth.uid() is not null and not public.is_tenant_allowed(p_tenant_id, auth.uid()) then
    raise exception 'Sem permissão';
  end if;

  delete from public.papa_testes pt
  using public.clients c4
  where c4.id = p_client_id
    and c4.tenant_id = p_tenant_id
    and coalesce(c4.is_trial, false) = false
    and pt.tenant_id = p_tenant_id
    and coalesce(pt.is_trial, true) = true
    and (
      pt.whatsapp_username = c4.whatsapp_username
      or lower(pt.username) = lower(c4.server_username)
      or (
        length(regexp_replace(coalesce(c4.whatsapp_username, ''), '\D', '', 'g')) >= 8
        and right(regexp_replace(coalesce(pt.phone_e164, pt.whatsapp_username, ''), '\D', '', 'g'), 8)
          = right(regexp_replace(c4.whatsapp_username, '\D', '', 'g'), 8)
      )
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.papa_testes_remove_for_client(uuid, uuid) from public, anon;
grant execute on function public.papa_testes_remove_for_client(uuid, uuid) to authenticated, service_role;

-- update_client (já aplicado 05/10/2026): o bloco final virou
--   if p_is_trial = false then
--     perform public.papa_testes_remove_for_client(p_tenant_id, p_client_id);
--   end if;
-- (antes: update papa_testes set converted = true ...)
