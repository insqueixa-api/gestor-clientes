-- ✅ 12/10/2026, pedido do Márcio: ordem dos apps no modal compartilhado
-- (admin, portal do cliente, portal da revenda) = estrelas → quantidade de
-- clientes que usam → com integração de configuração → alfabética.
-- Esta função dá a "quantidade de clientes que usam": clientes ATIVOS (sem
-- teste, sem lixeira, sem arquivados) com o app cadastrado, por app.
-- SECURITY INVOKER: no admin a RLS já limita ao tenant do usuário; nas rotas
-- do portal roda com service role e o tenant vem do parâmetro. Devolve só
-- contagem (nenhum dado de cliente).

create or replace function public.app_user_counts(p_tenant_id uuid)
returns table (app_id uuid, users integer)
language sql
stable
security invoker
set search_path = public
as $$
  select ca.app_id, count(distinct ca.client_id)::int as users
    from client_apps ca
    join clients c on c.id = ca.client_id
   where ca.tenant_id = p_tenant_id
     and c.is_trial is not true
     and c.is_archived is not true
     and c.deep_archived_at is null
   group by ca.app_id
$$;

revoke all on function public.app_user_counts(uuid) from public, anon;
grant execute on function public.app_user_counts(uuid) to authenticated, service_role;
