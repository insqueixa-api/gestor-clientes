-- Auditoria de alinhamento (07/08/2026), disparada pelo alerta "Security
-- Definer View" do vw_catalog_novidades. Ao checar TODAS as views (OK, só
-- essa estava sem security_invoker) resolvi checar também as ~76 funções
-- SECURITY DEFINER do projeto, já que é o mesmo tipo de risco (ignoram RLS).
--
-- Achado: TODA função nova no projeto recebe EXECUTE automático pra anon +
-- authenticated + service_role (default privilege configurado pelo próprio
-- Supabase no projeto, não é algo que o código controla). Isso é esperado
-- pras ~60 funções que já validam auth.uid()+tenant_members (mesmo padrão de
-- fix_unguarded_security_definer_functions.sql) ou que usam seu próprio
-- esquema de auth (portal_* usa token/pin, não Supabase Auth).
--
-- Mas 2 funções ficaram pra trás SEM nenhuma checagem, mesmo recebendo
-- EXECUTE de anon (usuário nem logado):
--
-- 1) client_message_schedule — agenda mensagem de WhatsApp arbitrária pra
--    QUALQUER client_id de QUALQUER tenant, sem checar se quem chama
--    pertence ao tenant. Hoje não tem nenhuma tela que chame essa função
--    (client_message_send_now é a usada), então corrigir aqui não quebra a
--    UI — só fecha uma porta que já estava aberta sem uso.
--
-- 2) update_server_credits_manual (as DUAS versões, 2 e 3 argumentos) —
--    sobrescreve o saldo de créditos de QUALQUER servidor de QUALQUER
--    tenant, sem checar tenant. A versão de 3 args até loga em audit_logs
--    com auth.uid(), mas só como registro — nunca usa isso pra bloquear
--    quem não devia estar chamando. A tela de servidor (novo_servidor.tsx)
--    só usa a versão de 2 args, sempre dentro do tenant do próprio usuário
--    logado — então adicionar a checagem não muda o comportamento normal,
--    só bloqueia quem tentar chamar via RPC direto pra outro tenant.

CREATE OR REPLACE FUNCTION public.client_message_schedule(p_tenant_id uuid, p_client_id uuid, p_message text, p_send_at timestamp with time zone, p_whatsapp_session text DEFAULT 'default'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'Mensagem vazia.';
  end if;

  if p_send_at is null then
    raise exception 'Data/hora inválida.';
  end if;

  if p_send_at <= now() then
    raise exception 'Agendamento deve ser no futuro.';
  end if;

  insert into public.client_message_jobs (
    tenant_id, client_id, whatsapp_session, message, send_at, status
  )
  values (
    p_tenant_id, p_client_id, p_whatsapp_session, p_message, p_send_at, 'SCHEDULED'
  )
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_server_credits_manual(p_server_id uuid, p_new_credits numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant_id uuid;
begin
  select tenant_id into v_tenant_id
  from public.servers
  where id = p_server_id;

  if not found then
    raise exception 'Server not found';
  end if;

  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = v_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  UPDATE public.servers
  SET credits_available = p_new_credits
  WHERE id = p_server_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_server_credits_manual(p_server_id uuid, p_new_credits numeric, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_old_credits numeric;
    v_tenant_id uuid;
BEGIN
    SELECT credits_available, tenant_id
    INTO v_old_credits, v_tenant_id
    FROM public.servers
    WHERE id = p_server_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Server not found';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.tenant_members tm
      WHERE tm.tenant_id = v_tenant_id AND tm.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED';
    END IF;

    IF v_old_credits = p_new_credits THEN
        RETURN;
    END IF;

    UPDATE public.servers
    SET credits_available = p_new_credits
    WHERE id = p_server_id;

    BEGIN
        INSERT INTO public.audit_logs (
            tenant_id,
            created_at,
            action,
            target_id,
            details,
            actor_id
        ) VALUES (
            v_tenant_id,
            NOW(),
            'MANUAL_ADJUSTMENT',
            p_server_id,
            format('Ajuste manual de saldo: De %s para %s. Motivo: %s', v_old_credits, p_new_credits, p_reason),
            auth.uid()
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Não foi possível criar log de auditoria: %', SQLERRM;
    END;
END;
$function$;

-- Achado relacionado: billing_claim_jobs / billing_mark_sent /
-- billing_mark_failed são funções de worker (fila billing_queue) que também
-- não checam tenant — mas essas nem têm chamador no repo do app (nenhuma
-- tela usa supabase.rpc pra elas), o que sugere que quem chama é um
-- processo externo já usando a service_role key. Pra esse tipo de função
-- "só pra worker", a correção certa não é adicionar auth.uid() (não tem
-- sessão de usuário lá), é tirar o acesso de anon/authenticated mesmo —
-- service_role continua funcionando normal (o grant dela é independente do
-- de PUBLIC/anon/authenticated).
REVOKE EXECUTE ON FUNCTION public.billing_claim_jobs(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.billing_mark_sent(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.billing_mark_failed(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
