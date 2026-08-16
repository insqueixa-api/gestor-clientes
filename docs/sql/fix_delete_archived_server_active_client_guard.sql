-- fix_delete_archived_server_active_client_guard.sql
-- ✅ 16/08/2026 — achado na auditoria final pré-"modo manutenção": o botão
-- "Excluir definitivamente" (app/admin/gerenciador/servidor/page.tsx,
-- handleHardDelete) chama delete_archived_server, que NUNCA checava se
-- ainda havia clientes ATIVOS (não arquivados) vinculados ao servidor —
-- só desvinculava todo mundo em silêncio (UPDATE clients SET server_id =
-- NULL) antes de apagar o servidor. Um admin achando que só tinha cliente
-- de teste vencido no servidor podia excluir e desvincular clientes
-- pagantes ativos sem nenhum aviso.
--
-- Já existia uma função mais nova (delete_server_hard) com essa validação
-- — mas ela faz muito mais que isso: APAGA de vez todos os clientes
-- (inclusive arquivados) vinculados ao servidor, com cascata agressiva em
-- ~15 tabelas (eventos, mensagens, cupons, etc.). Trocar a UI pra chamar
-- ela mudaria o comportamento de "excluir servidor" de "desvincula
-- clientes arquivados, mantém histórico" pra "apaga o histórico dos
-- clientes arquivados também" — mudança bem maior que o bug pedia pra
-- corrigir, e não documentada/pedida.
--
-- Fix mínimo: só adiciona a mesma checagem de "existem clientes ativos?"
-- em delete_archived_server, mantendo o resto do comportamento (desvincula
-- e mantém os arquivados, nunca apaga cliente nenhum) exatamente como já
-- era.

CREATE OR REPLACE FUNCTION public.delete_archived_server(p_tenant_id uuid, p_server_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_active_clients integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM servers
    WHERE id = p_server_id
    AND tenant_id = p_tenant_id
    AND is_archived = true
  ) THEN
    RAISE EXCEPTION 'Servidor não encontrado, não pertence ao tenant ou não está arquivado.';
  END IF;

  -- ✅ NOVO: bloqueia se ainda houver cliente ATIVO (não arquivado)
  -- vinculado — mesma proteção que delete_server_hard já tinha, mas sem
  -- adotar o resto do comportamento mais agressivo dela.
  SELECT count(*) INTO v_active_clients
  FROM public.clients
  WHERE server_id = p_server_id
    AND tenant_id = p_tenant_id
    AND coalesce(is_archived, false) = false;

  IF v_active_clients > 0 THEN
    RAISE EXCEPTION 'Existem % cliente(s) ativo(s) (não arquivados) vinculados a este servidor. Arquive-os antes de excluir o servidor definitivamente.', v_active_clients;
  END IF;

  DELETE FROM server_credit_usage   WHERE server_id = p_server_id;
  DELETE FROM server_credit_sales   WHERE server_id = p_server_id;
  DELETE FROM server_credit_purchases WHERE server_id = p_server_id;
  DELETE FROM server_events         WHERE server_id = p_server_id;
  DELETE FROM reseller_servers      WHERE server_id = p_server_id;
  DELETE FROM client_renewals       WHERE server_id = p_server_id;

  UPDATE clients SET server_id = NULL WHERE server_id = p_server_id AND tenant_id = p_tenant_id;

  DELETE FROM servers WHERE id = p_server_id AND tenant_id = p_tenant_id;
END;
$function$;
