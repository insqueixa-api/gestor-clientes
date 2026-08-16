-- docs/sql/fix_mark_app_renewal_postgrest_or_bug.sql
--
-- INCIDENTE 15/08/2026: pagamento de licença de app (DupleCast, cliente
-- Adenilson, R$30) ficou "PROCESSANDO" pra sempre — nunca virou notificação
-- no sino nem email. Causa raiz: markAppRenewalPaid (lib/client-portal/
-- fulfillment.ts) fazia UPDATE + .or() via supabase-js:
--
--   .update({...}).eq("tenant_id", t).eq("id", id)
--     .or("fulfillment_status.is.null,fulfillment_status.eq.pending")
--     .select("id")
--
-- Esse UPDATE+.or() combinado retorna erro do PostgREST
-- ("column client_portal_payments.fulfillment_status does not exist") —
-- confirmado ao vivo: SELECT+.or() na mesma coluna funciona, UPDATE sem
-- .or() funciona, só a combinação UPDATE+.or() quebra. UPDATE com o MESMO
-- WHERE via SQL puro funciona perfeito — é bug/limitação do PostgREST
-- nessa combinação específica, não do Postgres.
--
-- Pior: o código não checava o `error` do retorno, só `data` — o erro do
-- PostgREST fazia `data` vir null, e o guard "if (!updatedRows) return"
-- tratava isso EXATAMENTE igual a "já processado por outra chamada" —
-- falha silenciosa, indistinguível de comportamento normal, sem log nem
-- Sentry. Corrigido no código (fulfillment.ts) pra usar esta função em vez
-- do UPDATE+.or() via PostgREST, e pra logar/capturar no Sentry qualquer
-- erro real em vez de engolir.

create or replace function mark_app_renewal_manual_pending(
  p_payment_id uuid,
  p_tenant_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated boolean := false;
begin
  update client_portal_payments
  set fulfillment_status = 'manual_pending',
      fulfillment_error = null
  where id = p_payment_id
    and tenant_id = p_tenant_id
    and (fulfillment_status is null or fulfillment_status = 'pending')
  returning true into v_updated;

  return coalesce(v_updated, false);
end;
$$;

grant execute on function mark_app_renewal_manual_pending(uuid, uuid) to service_role;
