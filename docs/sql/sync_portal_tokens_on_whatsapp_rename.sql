-- Achado em 12/08/2026: portal_start_session() (chamada pelo login do
-- Portal) revalida o token contra o valor ATUAL de clients.whatsapp_username
-- (não confia só no valor congelado na hora que o token foi criado). Se o
-- cliente trocar de identidade (ex: de telefone puro pra um username
-- reservado do WhatsApp, coisa que vai passar a acontecer com frequência
-- conforme o WhatsApp libera usernames), TODOS os links mágicos já enviados
-- pra ele antes da troca passam a falhar com "invalid_credentials" — o token
-- continua existindo e ativo em client_portal_tokens, só que apontando pro
-- valor antigo, que não bate mais em nenhum cliente.
--
-- Fix: trigger em clients que, sempre que whatsapp_username ou
-- secondary_whatsapp_username mudar, atualiza client_portal_tokens (e
-- sessões ainda ativas em client_portal_sessions) que apontavam pro valor
-- ANTIGO pra passar a apontar pro NOVO — mantendo a MESMA string de token. O
-- cliente não recebe um link novo, o link antigo simplesmente continua
-- funcionando.
--
-- Guards importantes:
--   - só mexe se o valor NOVO existir (nunca escreve NULL em
--     client_portal_tokens.whatsapp_username, que é NOT NULL — sem isso, um
--     UPDATE que REMOVE o secundário, ex: seta pra NULL, quebraria a
--     transação inteira do update_client por causa de NOT NULL violation).
--   - só mexe se o valor ANTIGO não for nulo (senão não tem nada pra
--     re-atrelar) e se realmente mudou (IS DISTINCT FROM).
--   - SECURITY DEFINER: roda como dono da função independente de quem
--     disparou o UPDATE em clients (mesmo padrão dos outros triggers e RPCs
--     deste projeto), evitando problema de RLS na escrita.
CREATE OR REPLACE FUNCTION public.sync_portal_tokens_on_whatsapp_rename()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.whatsapp_username IS NOT NULL
     AND NEW.whatsapp_username IS NOT NULL
     AND NEW.whatsapp_username IS DISTINCT FROM OLD.whatsapp_username THEN
    UPDATE public.client_portal_tokens
       SET whatsapp_username = NEW.whatsapp_username
     WHERE tenant_id = NEW.tenant_id
       AND whatsapp_username = OLD.whatsapp_username;

    UPDATE public.client_portal_sessions
       SET whatsapp_username = NEW.whatsapp_username
     WHERE tenant_id = NEW.tenant_id
       AND whatsapp_username = OLD.whatsapp_username
       AND expires_at > now();
  END IF;

  IF OLD.secondary_whatsapp_username IS NOT NULL
     AND NEW.secondary_whatsapp_username IS NOT NULL
     AND NEW.secondary_whatsapp_username IS DISTINCT FROM OLD.secondary_whatsapp_username THEN
    UPDATE public.client_portal_tokens
       SET whatsapp_username = NEW.secondary_whatsapp_username
     WHERE tenant_id = NEW.tenant_id
       AND whatsapp_username = OLD.secondary_whatsapp_username;

    UPDATE public.client_portal_sessions
       SET whatsapp_username = NEW.secondary_whatsapp_username
     WHERE tenant_id = NEW.tenant_id
       AND whatsapp_username = OLD.secondary_whatsapp_username
       AND expires_at > now();
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_portal_tokens_on_whatsapp_rename ON public.clients;
CREATE TRIGGER trg_sync_portal_tokens_on_whatsapp_rename
AFTER UPDATE OF whatsapp_username, secondary_whatsapp_username ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.sync_portal_tokens_on_whatsapp_rename();
