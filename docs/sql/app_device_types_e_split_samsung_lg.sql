-- =====================================================================
-- 02/10/2026 — Aparelhos: logo editável + Samsung e LG separados
-- =====================================================================
-- 1) app_device_types: logo de cada aparelho (chaves fixas de
--    lib/apps/device-types.ts ou nome de aparelho cadastrado à mão, ex:
--    "PS5"). Editada no seletor de apps do admin (lápis no hover), mostrada
--    também no portal (app/api/client-portal/apps/catalog devolve).
create table if not exists public.app_device_types (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  device_key text not null,
  icon_url text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, device_key)
);
alter table public.app_device_types enable row level security;

drop policy if exists app_device_types_tenant_member on public.app_device_types;
create policy app_device_types_tenant_member on public.app_device_types
  for all to authenticated
  using (exists (select 1 from public.tenant_members tm where tm.tenant_id = app_device_types.tenant_id and tm.user_id = auth.uid()))
  with check (exists (select 1 from public.tenant_members tm where tm.tenant_id = app_device_types.tenant_id and tm.user_id = auth.uid()));
revoke all on public.app_device_types from anon;

-- 2) Coluna nova com URL do R2 entra na lista de "em uso" (docs/sql/r2_url_in_use.sql)
create or replace function public._r2_refs_blob()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(string_agg(t, ' '), '') from (
              select logo_url t from public.servers
    union all select icon_url from public.apps
    union all select icon_url from public.server_integrations
    union all select icon_url from public.api_integrations
    union all select icon_url from public.app_integrations
    union all select config->>'icon_url' from public.payment_gateways
    union all select logo_url from public.condominios
    union all select fotos::text from public.condominio_acoes
    union all select pdf_url from public.condominio_edicoes
    union all select itens::text from public.condominio_edicoes
    union all select image_url from public.message_templates
    union all select image_url from public.client_message_jobs
    union all select logo_url from public.tenants
    union all select banner_urls::text from public.tenants
    union all select icon_url from public.app_device_types
  ) x where t is not null and t <> '';
$function$;

-- 3) Samsung / LG separados: quem era compatível com os dois continua
--    compatível com os dois. O valor antigo 'SAMSUNG_LG' FICA por enquanto
--    (o código em produção antes do deploy ainda filtra por ele); o código
--    novo ignora (LEGACY_DEVICE_KEYS). Limpeza depois do deploy:
--    update public.apps set device_types = array_remove(device_types, 'SAMSUNG_LG');
update public.apps
set device_types = (
  select array_agg(distinct d order by d)
  from unnest(device_types || array['SAMSUNG','LG']) d
)
where 'SAMSUNG_LG' = any(device_types)
  and not ('SAMSUNG' = any(device_types) and 'LG' = any(device_types));
