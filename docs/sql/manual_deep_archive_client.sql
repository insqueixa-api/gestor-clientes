-- ✅ 05/09/2026, pedido do Márcio: faltava um jeito MANUAL de mandar um
-- cliente já arquivado direto pro "Arquivado" (deep_archived), sem
-- esperar os 61 dias do cron automático — útil pra teste e também real
-- (às vezes o admin já sabe que aquele cliente nunca mais volta).
-- Mesmo padrão de clear_deep_archived — função pequena e dedicada.
CREATE OR REPLACE FUNCTION public.manual_deep_archive_client(p_tenant_id uuid, p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_is_archived boolean;
  v_is_trial boolean;
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select c.is_archived, coalesce(c.is_trial, false)
    into v_is_archived, v_is_trial
  from public.clients c
  where c.tenant_id = p_tenant_id and c.id = p_client_id;

  if not found then
    raise exception 'Cliente não encontrado para este tenant.';
  end if;
  if not v_is_archived then
    raise exception 'Só é possível arquivar profundamente um cliente que já está na Lixeira.';
  end if;
  if v_is_trial then
    raise exception 'Clientes de teste não usam arquivamento profundo (são excluídos de verdade pelo cron).';
  end if;

  update public.clients
  set deep_archived_at = now(),
      updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_client_id;
end;
$function$;
