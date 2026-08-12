-- ============================================================================
-- Ancoragem por telefone para o Portal do Cliente sobreviver a troca de
-- whatsapp_username (telefone -> username reservado do WhatsApp), quando
-- várias contas compartilham o mesmo WhatsApp real.
-- ============================================================================
--
-- Contexto: várias contas de um mesmo tenant podem legitimamente
-- compartilhar o mesmo whatsapp_username (mesmo WhatsApp gerenciando várias
-- assinaturas — cenário real e comum aqui). O código mágico do Portal
-- (client_portal_tokens) e a sessão (client_portal_sessions) até então eram
-- resolvidos só por igualdade de TEXTO com whatsapp_username/
-- secondary_whatsapp_username. Isso quebra de duas formas diferentes quando
-- uma dessas contas troca de identidade (ex: pra um username):
--
--   1) LOGIN: portal_start_session() revalida o token contra o valor ATUAL
--      de clients.whatsapp_username — sem ancoragem, ele simplesmente para
--      de achar qualquer cliente e o login falha.
--   2) LISTAGEM DE CONTAS: mesmo com o login funcionando, get-accounts e
--      validatePortalClient (usada por quase toda rota do Bloco 1/Bloco 3 do
--      Portal) filtram clients por igualdade de texto contra
--      session.whatsapp_username (congelado na criação da sessão) — a conta
--      que trocou de identidade simplesmente some da lista, mesmo a sessão
--      sendo válida.
--
-- ⚠️ Tentativa anterior (mesmo dia, REMOVIDA): uma trigger que "movia" o
-- texto do token pra seguir a conta renomeada. Bug achado em teste ao vivo:
-- quando N contas compartilhavam o token, a trigger o REDIRECIONAVA todo pra
-- só a conta renomeada, quebrando o acesso das outras N-1 — pior que o
-- problema original. Removida e substituída por esta abordagem: em vez de
-- mover o token entre identidades, ele passa a carregar uma ÂNCORA
-- (phone_e164 normalizado) que é resolvida no MOMENTO da criação e nunca
-- mais precisa mudar — a checagem de validade passa a aceitar "ainda existe
-- ALGUM cliente com esse texto OU com esse telefone-âncora", sem precisar
-- reescrever nada quando uma conta troca de identidade.
--
-- Compatibilidade: tokens/sessões criados ANTES desta migração têm
-- phone_anchor = NULL — continuam funcionando exatamente como antes (o
-- fallback por texto puro nunca foi removido, só passou a ter uma segunda
-- via em paralelo). phone_anchor é preenchido lazy (na primeira vez que o
-- token antigo é reutilizado) e sempre em tokens/sessões novos.

-- 1) Colunas novas (nullable — retrocompatível) ------------------------------
ALTER TABLE public.client_portal_tokens ADD COLUMN IF NOT EXISTS phone_anchor text;
ALTER TABLE public.client_portal_sessions ADD COLUMN IF NOT EXISTS phone_anchor text;

CREATE INDEX IF NOT EXISTS idx_client_portal_tokens_phone_anchor
  ON public.client_portal_tokens (tenant_id, phone_anchor)
  WHERE phone_anchor IS NOT NULL;

-- 2) RPC central: quais client_id batem numa identidade (texto OU âncora) ---
-- Reaproveitada por portal_start_session (existência), validatePortalClient
-- e get-accounts (TypeScript, via supabase.rpc) — uma fonte só de verdade
-- pra "essa sessão pode ver/mexer em qual(is) cliente(s)".
CREATE OR REPLACE FUNCTION public.portal_client_ids_for_identity(
  p_tenant_id uuid,
  p_whatsapp_username text,
  p_phone_anchor text DEFAULT NULL
)
RETURNS TABLE(id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- ⚠️ CORRIGIDO em 12/08/2026 (achado testando com um username aleatório de
  -- verdade, com underscore): p_whatsapp_username chega aqui já NORMALIZADO
  -- quando vem de um token/sessão (portal_admin_create_token_for_whatsapp_v2
  -- sempre grava normalize_phone(valor) em client_portal_tokens.whatsapp_username,
  -- nunca o texto cru) — mas clients.whatsapp_username guarda o texto CRU,
  -- como o admin digitou (pode ter "_", ".", etc.). Comparar sem normalizar
  -- os dois lados só "funcionava" por acidente para telefone (dígitos puros
  -- não mudam ao normalizar) — qualquer username com caractere fora de
  -- [a-zA-Z0-9] quebrava o login (client_id nunca era encontrado). Mesma
  -- normalização dos dois lados, igual o resto do sistema já fazia.
  SELECT c.id
  FROM public.clients c
  WHERE c.tenant_id = p_tenant_id
    AND (
      public.normalize_phone(c.whatsapp_username) = public.normalize_phone(p_whatsapp_username)
      OR public.normalize_phone(c.secondary_whatsapp_username) = public.normalize_phone(p_whatsapp_username)
      OR (p_phone_anchor IS NOT NULL AND public.normalize_phone(c.phone_e164) = p_phone_anchor)
      OR (p_phone_anchor IS NOT NULL AND public.normalize_phone(c.secondary_phone_e164) = p_phone_anchor)
    );
$function$;

-- 3) portal_admin_create_token_for_whatsapp_v2 — resolve/reaproveita/cria
--    token já pensando na âncora ------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_admin_create_token_for_whatsapp_v2(p_tenant_id uuid, p_whatsapp_username text, p_created_by uuid, p_label text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(token text, token_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

  -- Resolve o cliente pelo texto (comportamento de sempre) e sua âncora de
  -- telefone. Contato sem cliente correspondente é situação normal (não é
  -- cliente ainda, número errado, etc.) — retorna vazio em vez de exceção.
  select public.normalize_phone(c.phone_e164)
    into v_phone_anchor
  from public.clients c
  where c.tenant_id = p_tenant_id
    and (public.normalize_phone(c.whatsapp_username) = v_whats or public.normalize_phone(c.secondary_whatsapp_username) = v_whats)
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

-- 4) portal_start_session — valida e cria sessão já carregando a âncora ----
CREATE OR REPLACE FUNCTION public.portal_start_session(p_token text, p_pin text DEFAULT NULL::text)
 RETURNS TABLE(session_token text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_tenant_id uuid;
  v_whatsapp text;
  v_phone_anchor text;
  v_now timestamptz := now();
  v_session text;
begin
  select t.tenant_id, t.whatsapp_username, t.phone_anchor
    into v_tenant_id, v_whatsapp, v_phone_anchor
  from public.client_portal_tokens t
  where t.token = p_token
    and t.is_active is true
    and (t.expires_at is null or t.expires_at > v_now)
  limit 1;

  if v_tenant_id is null then
    raise exception 'invalid_credentials';
  end if;

  if not exists (
    select 1 from public.portal_client_ids_for_identity(v_tenant_id, v_whatsapp, v_phone_anchor)
  ) then
    raise exception 'invalid_credentials';
  end if;

  v_session := public.generate_portal_token(32);

  insert into public.client_portal_sessions(
    tenant_id, whatsapp_username, session_token, expires_at, last_seen_at, phone_anchor
  ) values (
    v_tenant_id, v_whatsapp, v_session, v_now + interval '30 minutes', v_now, v_phone_anchor
  );

  update public.client_portal_tokens
  set last_used_at = v_now
  where token = p_token;

  session_token := v_session;
  expires_at := v_now + interval '30 minutes';
  return next;
end;
$function$;

-- 5) portal_resolve_token — exibição usa o texto CRU do cliente, não o
--    normalizado guardado no token ------------------------------------------
-- ⚠️ CORRIGIDO em 12/08/2026 (achado testando com um username real com "_"):
-- a versão anterior devolvia t.whatsapp_username (SEMPRE normalizado — é
-- assim que fica gravado no token desde a criação) direto pra tela de login,
-- que usa esse valor só pra EXIBIR/pré-preencher o campo. Pra telefone isso
-- nunca importou (dígitos puros não mudam ao normalizar), mas pra username
-- com caractere fora de [a-zA-Z0-9] (ex: "zeleite_bd79f4") o cliente via
-- "zeleitebd79f4" na tela — sumia o "_", parecia (e não é) um valor errado.
-- Passa a buscar o whatsapp_username CRU de um cliente de verdade que bate
-- com essa identidade (texto OU âncora de telefone) e mostra esse; a
-- checagem de acesso (portal_client_ids_for_identity, portal_start_session)
-- continua 100% baseada em normalização — isto é puramente cosmético, não
-- muda quem consegue entrar em lugar nenhum.
CREATE OR REPLACE FUNCTION public.portal_resolve_token(p_token text)
 RETURNS TABLE(tenant_id uuid, whatsapp_username text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := now();
  v_tenant_id uuid;
  v_whats text;
  v_phone_anchor text;
  v_raw text;
begin
  select t.tenant_id, t.whatsapp_username, t.phone_anchor
    into v_tenant_id, v_whats, v_phone_anchor
  from public.client_portal_tokens t
  where t.token = p_token
    and t.is_active is true
    and (t.expires_at is null or t.expires_at > v_now)
  limit 1;

  if v_tenant_id is null then
    return;
  end if;

  select c.whatsapp_username into v_raw
  from public.clients c
  where c.tenant_id = v_tenant_id
    and (
      public.normalize_phone(c.whatsapp_username) = v_whats
      or public.normalize_phone(c.secondary_whatsapp_username) = v_whats
      or (v_phone_anchor is not null and public.normalize_phone(c.phone_e164) = v_phone_anchor)
      or (v_phone_anchor is not null and public.normalize_phone(c.secondary_phone_e164) = v_phone_anchor)
    )
  order by c.created_at asc
  limit 1;

  tenant_id := v_tenant_id;
  whatsapp_username := coalesce(v_raw, v_whats);
  return next;
end;
$function$;
