-- =====================================================================
-- 30/09/2026 — Link do portal do contato SECUNDÁRIO abria como TITULAR
-- =====================================================================
-- Sintoma (Márcio): secundário clica no link, o portal mostra "logado
-- como <titular>", e o Log do Portal grava o titular como pagador
-- (payer_whatsapp_username) — independente de quem pagou.
--
-- Causa: portal_admin_create_token_for_whatsapp_v2 achava o cliente pelo
-- número (titular OU secundário), mas SEMPRE usava a âncora do titular
-- (c.phone_e164). No passo 1 reaproveitava o token mais recente dessa
-- âncora = o token do titular. A sessão herda o whatsapp_username do
-- token (portal_start_session), então o secundário virava o titular em
-- tudo. Os tokens dos secundários pararam de ser usados no início de
-- agosto/2026, quando a âncora entrou.
--
-- Fix: a âncora é a do lado que casou — número do titular → phone_e164,
-- número do secundário → secondary_phone_e164. Se o mesmo número for
-- titular numa conta e secundário noutra, prefere o lado titular (é a
-- mesma pessoa — mesmo token, como antes). Resto da função idêntico.
create or replace function public.portal_admin_create_token_for_whatsapp_v2(
  p_tenant_id uuid,
  p_whatsapp_username text,
  p_created_by uuid,
  p_label text default null::text,
  p_expires_at timestamp with time zone default null::timestamp with time zone
)
returns table(token text, token_id uuid)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_now timestamptz := now();
  v_whats text := public.normalize_phone(p_whatsapp_username);
  v_exp timestamptz := p_expires_at;
  v_phone_anchor text;
begin
  if v_whats = '' then
    raise exception 'whatsapp_required';
  end if;

  if p_created_by is not null then
    if not exists (
      select 1
      from public.tenant_members tm
      where tm.tenant_id = p_tenant_id
        and tm.user_id   = p_created_by
    ) then
      raise exception 'not_allowed';
    end if;
  end if;

  -- Resolve o cliente pelo texto (comportamento de sempre) e a âncora de
  -- telefone DO LADO QUE CASOU (titular ou secundário). Contato sem
  -- cliente correspondente é situação normal — retorna vazio.
  select case
           when public.normalize_phone(c.whatsapp_username) = v_whats
             then public.normalize_phone(c.phone_e164)
           else public.normalize_phone(c.secondary_phone_e164)
         end
    into v_phone_anchor
  from public.clients c
  where c.tenant_id = p_tenant_id
    and (public.normalize_phone(c.whatsapp_username) = v_whats or public.normalize_phone(c.secondary_whatsapp_username) = v_whats)
  order by (public.normalize_phone(c.whatsapp_username) = v_whats) desc
  limit 1;

  if not found then
    return;
  end if;

  if v_phone_anchor = '' then
    v_phone_anchor := null;
  end if;

  -- 1) Tenta reaproveitar um token já existente PELA ÂNCORA (cobre várias
  -- contas compartilhando o mesmo WhatsApp, mesmo que quem está pedindo
  -- agora tenha um texto de identidade diferente do que criou o token).
  if v_phone_anchor is not null then
    select t.token, t.id
      into token, token_id
    from public.client_portal_tokens t
    where t.tenant_id = p_tenant_id
      and t.phone_anchor = v_phone_anchor
      and coalesce(t.is_active, true) is true
      and (t.expires_at is null or t.expires_at > v_now)
    order by t.created_at desc
    limit 1;
  end if;

  -- 2) Sem âncora ainda achada: cai no casamento por texto exato de sempre
  -- (cobre tokens antigos, criados antes desta migração, e clientes sem
  -- telefone cadastrado). Se achar por aqui, aproveita e preenche a âncora
  -- agora — próximos lookups já usam o caminho robusto.
  if token is null then
    select t.token, t.id
      into token, token_id
    from public.client_portal_tokens t
    where t.tenant_id = p_tenant_id
      and public.normalize_phone(t.whatsapp_username) = v_whats
      and coalesce(t.is_active, true) is true
      and (t.expires_at is null or t.expires_at > v_now)
    order by t.created_at desc
    limit 1;

    if token is not null and v_phone_anchor is not null then
      update public.client_portal_tokens set phone_anchor = v_phone_anchor where id = token_id;
    end if;
  end if;

  if token is not null then
    update public.client_portal_tokens
      set last_used_at = v_now
    where id = token_id;

    return next;
    return;
  end if;

  -- Gera token novo apenas se for a primeira vez desse telefone/cluster
  token := public.generate_portal_token(32);

  insert into public.client_portal_tokens(
    tenant_id, whatsapp_username, token, expires_at, created_by, label, phone_anchor
  ) values (
    p_tenant_id, v_whats, token, v_exp, p_created_by, p_label, v_phone_anchor
  ) returning id into token_id;

  return next;
end;
$function$;
