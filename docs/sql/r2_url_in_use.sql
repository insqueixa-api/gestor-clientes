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
-- Quando surgir coluna nova que guarde URL do R2, ela TEM que entrar aqui.
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

  return
       exists (select 1 from public.servers where logo_url = p_url)
    or exists (select 1 from public.apps where icon_url = p_url)
    or exists (select 1 from public.server_integrations where icon_url = p_url)
    or exists (select 1 from public.api_integrations where icon_url = p_url)
    or exists (select 1 from public.app_integrations where icon_url = p_url)
    or exists (select 1 from public.payment_gateways where config->>'icon_url' = p_url)
    or exists (select 1 from public.condominios where logo_url = p_url)
    or exists (select 1 from public.condominio_acoes where strpos(fotos::text, p_url) > 0)
    or exists (select 1 from public.condominio_edicoes where pdf_url = p_url or strpos(itens::text, p_url) > 0)
    or exists (select 1 from public.message_templates where image_url = p_url)
    or exists (select 1 from public.client_message_jobs where image_url = p_url)
    or exists (select 1 from public.tenants where logo_url = p_url or strpos(coalesce(banner_urls::text, ''), p_url) > 0);
end;
$$;

revoke all on function public.r2_url_in_use(text) from public, anon;
grant execute on function public.r2_url_in_use(text) to authenticated, service_role;
