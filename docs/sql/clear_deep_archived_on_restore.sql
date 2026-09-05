-- ✅ 05/09/2026: se o admin restaura (des-arquiva) um cliente que já tinha
-- virado "Arquivado" (deep_archived_at preenchido), esse campo precisa ser
-- limpo também -- senão o cliente volta pra lista ativa mas continua
-- invisível no Portal (o filtro de lá é só por deep_archived_at, não por
-- is_archived). Função pequena e dedicada em vez de mexer em update_client
-- (29 parâmetros, usada em todo fluxo de edição de cliente -- risco
-- desnecessário pra essa necessidade específica).
CREATE OR REPLACE FUNCTION public.clear_deep_archived(p_tenant_id uuid, p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.clients
  set deep_archived_at = null,
      updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_client_id;
end;
$function$;
