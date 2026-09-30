-- =====================================================================
-- 30/09/2026 — R2: apagar arquivo antigo só quando ninguém mais usa
-- =====================================================================
-- Achado do Márcio: trocar logo (servidor etc.) nunca apagava a anterior
-- no R2, só acumulava; excluir Edição do condomínio deixava o PDF órfão.
--
-- A rota DELETE /api/upload passou a ser chamada em toda troca/remoção,
-- mas SÓ apaga depois de perguntar aqui se a URL ainda aparece em alguma
-- coluna do banco. Isso é o que protege os casos compartilhados:
-- condominio_edicoes.itens COPIA as URLs das fotos das Ações — trocar a
-- foto de uma Ação não pode quebrar uma Edição já publicada que usa ela.
--
-- _r2_refs_blob() é a ÚNICA lista de colunas que guardam URL do R2 — usada
-- tanto pela checagem de troca (r2_url_in_use) quanto pela varredura de
-- órfãos (app/api/admin/r2/orphans). Coluna nova com URL do R2 TEM que
-- entrar aqui. Casamento por substring: na dúvida o arquivo FICA (falso
-- positivo só deixa um órfão, nunca apaga algo em uso).
create or replace function public._r2_refs_blob()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
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
  ) x where t is not null and t <> '';
$$;

revoke all on function public._r2_refs_blob() from public, anon, authenticated;
grant execute on function public._r2_refs_blob() to service_role;

create or replace function public.r2_url_in_use(p_url text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.tenant_members tm where tm.user_id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_url is null or btrim(p_url) = '' then
    return false;
  end if;

  return strpos(public._r2_refs_blob(), p_url) > 0;
end;
$$;

revoke all on function public.r2_url_in_use(text) from public, anon;
grant execute on function public.r2_url_in_use(text) to authenticated, service_role;
