-- ✅ 06/10/2026, pedido do Márcio: filtro só existe se tiver o que filtrar.
-- Conta quantos clientes cabem em cada opção dos filtros da tela de Clientes,
-- com EXATAMENTE as mesmas regras de get_clients_list_page (status, servidor,
-- vencimento, validade dos apps, Arquivado/Desvinculado). Contagem sobre a
-- lista inteira (ativos ou arquivados), não cruzada com os outros filtros —
-- a pergunta é "existe alguém nessa opção?". Plano e app por nome já vêm de
-- get_client_plan_periods / get_client_used_apps (só valores em uso).
-- SECURITY INVOKER (padrão) + tenant do usuário logado, igual à listagem.
create or replace function public.get_clients_filter_facets(p_archived boolean default false)
returns jsonb
language sql
stable
as $$
with tenant as (
  select tm.tenant_id from public.tenant_members tm where tm.user_id = auth.uid() limit 1
),
sp as (
  select (now() at time zone 'America/Sao_Paulo')::date as today
),
base as materialized (
  select
    c.id,
    c.server_id,
    c.deep_archived_at,
    case when c.vencimento < now() then 'Vencido' else 'Ativo' end as status_label,
    ((c.vencimento at time zone 'America/Sao_Paulo')::date - sp.today) as diff_days,
    date_trunc('month', c.vencimento at time zone 'America/Sao_Paulo')
      = date_trunc('month', now() at time zone 'America/Sao_Paulo') as same_month,
    case when not p_archived then (
      select min(dv.expire_date)::date
      from public.client_apps ca2
      join public.apps a2 on a2.id = ca2.app_id
      left join lateral (
        select ca2.field_values ->> (fc_v.value ->> 'id') as expire_date
        from jsonb_array_elements(a2.fields_config) fc_v(value)
        where (fc_v.value ->> 'type') = 'date'
          and (ca2.field_values ->> (fc_v.value ->> 'id')) ~ '^\d{4}-\d{2}-\d{2}$'
        limit 1
      ) dv on true
      where ca2.client_id = c.id
    ) end - sp.today as app_days
  from public.clients c
  cross join sp
  join tenant t on c.tenant_id = t.tenant_id
  where c.is_archived = p_archived and c.is_trial = false
)
select jsonb_build_object(
  'status', jsonb_build_object(
    'Ativo', (select count(*) from base where status_label = 'Ativo'),
    'Vencido', (select count(*) from base where status_label = 'Vencido')
  ),
  'servers', coalesce((
    select jsonb_object_agg(server_id, n)
    from (select server_id, count(*) n from base where server_id is not null group by server_id) s
  ), '{}'::jsonb),
  'due', jsonb_build_object(
    'Venceu há 2 dias', (select count(*) from base where diff_days = -2),
    'Venceu Ontem', (select count(*) from base where diff_days = -1),
    'Hoje', (select count(*) from base where diff_days = 0),
    'Vence Amanhã', (select count(*) from base where diff_days = 1),
    'Vence em 2 dias', (select count(*) from base where diff_days = 2),
    'Mês Atual', (select count(*) from base where same_month)
  ),
  'app_windows', jsonb_build_object(
    '15_dias', (select count(*) from base where app_days is not null and app_days <= 15),
    '30_dias', (select count(*) from base where app_days is not null and app_days <= 30),
    'mais_30_dias', (select count(*) from base where app_days is not null and app_days > 30)
  ),
  'archived', jsonb_build_object(
    'Arquivado', (select count(*) from base where deep_archived_at is null),
    'Desvinculado', (select count(*) from base where deep_archived_at is not null)
  )
);
$$;

revoke all on function public.get_clients_filter_facets(boolean) from public, anon;
grant execute on function public.get_clients_filter_facets(boolean) to authenticated;
