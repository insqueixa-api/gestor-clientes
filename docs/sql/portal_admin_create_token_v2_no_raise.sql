-- portal_admin_create_token_for_whatsapp_v2 usava RAISE EXCEPTION pra "contato
-- sem cliente correspondente no tenant" — situação NORMAL (qualquer contato
-- que não é cliente cai aqui toda vez que generatePortalLink roda), não um
-- erro de verdade. O app (lib/whatsapp/template-vars.ts generatePortalLink)
-- já trata "sem token" e "erro" exatamente igual, então RAISE só servia pra
-- poluir o log de erros do Postgres (achado via log em 24-25/07/2026). Troca
-- por RETURN vazio — mesmo comportamento no app, sem barulho no log.
CREATE OR REPLACE FUNCTION public.portal_admin_create_token_for_whatsapp_v2(p_tenant_id uuid, p_whatsapp_username text, p_created_by uuid, p_label text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(token text, token_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_now timestamptz := now();
  v_whats text := public.normalize_phone(p_whatsapp_username);
  -- 🔥 REMOVIDA A REGRA DOS 30 DIAS: Agora, se não for enviada uma data específica, o token é VITALÍCIO (NULL)
  v_exp timestamptz := p_expires_at;
begin
  if v_whats = '' then
    raise exception 'whatsapp_required';
  end if;

  -- Permite que automações e cronjobs (p_created_by NULO) gerem o token!
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

  -- Busca nas duas colunas (Principal e Secundária). Contato sem cliente
  -- correspondente é situação normal (não é cliente ainda, número errado,
  -- etc.) — retorna vazio em vez de lançar exceção.
  if not exists (
    select 1
    from public.clients c
    where c.tenant_id = p_tenant_id
      and (public.normalize_phone(c.whatsapp_username) = v_whats or public.normalize_phone(c.secondary_whatsapp_username) = v_whats)
  ) then
    return;
  end if;

  -- Puxa token existente (agora sempre vai achar, pois não expiram mais)
  select t.token, t.id
    into token, token_id
  from public.client_portal_tokens t
  where t.tenant_id = p_tenant_id
    and public.normalize_phone(t.whatsapp_username) = v_whats
    and coalesce(t.is_active, true) is true
    and (t.expires_at is null or t.expires_at > v_now)
  order by t.created_at desc
  limit 1;

  if token is not null then
    update public.client_portal_tokens
      set last_used_at = v_now
    where id = token_id;

    return next;
    return;
  end if;

  -- Gera token novo apenas se for a primeira vez do cliente
  token := public.generate_portal_token(32);

  insert into public.client_portal_tokens(
    tenant_id, whatsapp_username, token, expires_at, created_by, label
  ) values (
    p_tenant_id, v_whats, token, v_exp, p_created_by, p_label
  ) returning id into token_id;

  return next;
end;
$function$
