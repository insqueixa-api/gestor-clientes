-- ✅ 12/10/2026, achado investigando moeda dos pagamentos de app: a cotação
-- (tenant_fx_rates) estava CONGELADA desde 05/08/2026. A rota do cron diário
-- (app/api/fx/sync, criada nesse dia) roda com service role e chamava
-- set_tenant_fx_rates, que só aceitava usuário logado (auth.uid() membro do
-- tenant) → "NOT_AUTHORIZED" todo dia, em silêncio (o cron fx_sync_daily
-- aparecia como "succeeded" porque só dispara o pedido).
-- Correção: service role (o cron) também pode gravar. Usuário logado segue
-- com a mesma checagem de antes.

create or replace function public.set_tenant_fx_rates(
  p_tenant_id uuid,
  p_usd_to_brl numeric,
  p_eur_to_brl numeric,
  p_as_of_date date default null::date,
  p_source text default null::text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_allowed boolean;
begin
  select auth.role() = 'service_role'
         or exists (
           select 1
           from public.tenant_members tm
           where tm.tenant_id = p_tenant_id
             and tm.user_id = auth.uid()
         )
    into v_allowed;

  if not coalesce(v_allowed, false) then raise exception 'NOT_AUTHORIZED'; end if;

  if p_usd_to_brl is null or p_usd_to_brl <= 0 then raise exception 'INVALID_USD_RATE'; end if;
  if p_eur_to_brl is null or p_eur_to_brl <= 0 then raise exception 'INVALID_EUR_RATE'; end if;

  insert into public.tenant_fx_rates (tenant_id, usd_to_brl, eur_to_brl, as_of_date, source, updated_at)
  values (p_tenant_id, p_usd_to_brl, p_eur_to_brl, p_as_of_date, p_source, now())
  on conflict (tenant_id)
  do update set
    usd_to_brl = excluded.usd_to_brl,
    eur_to_brl = excluded.eur_to_brl,
    as_of_date = excluded.as_of_date,
    source = excluded.source,
    updated_at = now();
end;
$function$;

revoke all on function public.set_tenant_fx_rates(uuid, numeric, numeric, date, text) from public, anon;
