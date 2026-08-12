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
-- ⚠️ CORRIGIDO em 12/08/2026 (mesmo dia, achado em teste ao vivo antes de
-- afetar cliente real): a primeira versão desta trigger realinhava o token
-- pro valor ANTIGO sem checar se OUTRO cliente ainda usa esse mesmo valor —
-- várias contas legitimamente compartilham o mesmo whatsapp_username (mesmo
-- número de WhatsApp gerenciando várias assinaturas). Nesse caso, o token é
-- compartilhado entre elas (portal_start_session só checa "existe algum
-- cliente com esse whatsapp_username", não qual). Sem o guard abaixo, quando
-- UMA dessas contas trocava de identidade, a trigger "roubava" o token
-- compartilhado e o redirecionava só pra ela — quebrando o acesso de todas
-- as outras contas que ainda dependiam do valor antigo. Agora só realinha o
-- token se, depois da troca, NENHUM outro cliente do tenant ainda usa o
-- valor antigo (ou seja, o token estava mesmo dedicado só a essa conta).
-- Se outros ainda compartilham o valor antigo, o token fica intacto pra
-- eles, e a conta renomeada ganha um token novo na próxima vez que
-- generatePortalLink/portal_admin_create_token_for_whatsapp_v2 rodar pra
-- ela (comportamento correto: é uma identidade nova de verdade agora).
--
-- Guards importantes:
--   - só mexe se o valor NOVO existir (nunca escreve NULL em
--     client_portal_tokens.whatsapp_username, que é NOT NULL — sem isso, um
--     UPDATE que REMOVE o secundário, ex: seta pra NULL, quebraria a
--     transação inteira do update_client por causa de NOT NULL violation).
--   - só mexe se o valor ANTIGO não for nulo (senão não tem nada pra
--     re-atrelar) e se realmente mudou (IS DISTINCT FROM).
--   - só realinha se o valor antigo ficou "órfão" (nenhum outro cliente do
--     tenant ainda o usa) — ver explicação acima.
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
    IF NOT EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.tenant_id = NEW.tenant_id
        AND c.id <> NEW.id
        AND (c.whatsapp_username = OLD.whatsapp_username
             OR c.secondary_whatsapp_username = OLD.whatsapp_username)
    ) THEN
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
  END IF;

  IF OLD.secondary_whatsapp_username IS NOT NULL
     AND NEW.secondary_whatsapp_username IS NOT NULL
     AND NEW.secondary_whatsapp_username IS DISTINCT FROM OLD.secondary_whatsapp_username THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.tenant_id = NEW.tenant_id
        AND c.id <> NEW.id
        AND (c.whatsapp_username = OLD.secondary_whatsapp_username
             OR c.secondary_whatsapp_username = OLD.secondary_whatsapp_username)
    ) THEN
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
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_portal_tokens_on_whatsapp_rename ON public.clients;
CREATE TRIGGER trg_sync_portal_tokens_on_whatsapp_rename
AFTER UPDATE OF whatsapp_username, secondary_whatsapp_username ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.sync_portal_tokens_on_whatsapp_rename();
