-- ✅ 05/09/2026, pedido do Márcio: renovação manual iniciada direto pela
-- página do Cliente (recarga_cliente.tsx, SEM paymentLogId — ou seja, não é
-- a conclusão de uma pendência que já existia no Log do Portal) passa a
-- também gravar uma linha em client_portal_payments, pra virar o mesmo
-- "fluxo de renovações" que já existe pros pagamentos automáticos (MP/
-- Stripe/FastDePix) e pros manuais resolvidos via Auditoria.
--
-- Já nasce como "concluído" (status=manual_approved, fulfillment_status=
-- manual_done, fulfilled_at=now()) — igual ao estado final que uma
-- transferência (Revolut) recebe hoje depois de confirmada na Auditoria —
-- porque o dinheiro já foi recebido e a renovação já aconteceu de verdade
-- ANTES dessa função ser chamada; não existe uma etapa "aguardando".
--
-- gateway_type é decidido pela moeda do cliente (mesmo mapeamento dos
-- gateways de fallback manual já cadastrados: pix_manual/BRL,
-- transfer_manual_eur/EUR, transfer_manual_usd/USD) — aparece na Auditoria
-- como "PIX (Manual)" ou "Revolut (Manual)", igual já acontece pros que
-- vêm pelo Portal.
--
-- ⚠️ Duplicação: esta função só deve ser chamada quando NÃO existe
-- paymentLogId (renovação nova, avulsa) — quando a Auditoria já tem uma
-- linha pendente e o admin clica "Concluir"/"Confirmar recebimento", o
-- fluxo continua sendo o mesmo de sempre (update_fulfillment_status +
-- approve_manual_payment na linha JÁ EXISTENTE, nunca uma linha nova).
-- ⚠️ CREATE OR REPLACE com uma lista de parâmetros diferente cria um
-- SEGUNDO overload em vez de substituir (pegadinha já vivida antes nesta
-- mesma base — ver get_clients_list_page) — por isso o DROP explícito da
-- assinatura sem p_whatsapp_status antes de recriar.
DROP FUNCTION IF EXISTS public.log_manual_renewal_payment(uuid, uuid, numeric, text, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.log_manual_renewal_payment(
  p_tenant_id uuid,
  p_client_id uuid,
  p_price_amount numeric,
  p_price_currency text,
  p_period text,
  p_plan_label text,
  p_new_vencimento timestamptz,
  p_whatsapp_status text DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_gateway_type text;
begin
  if not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid()
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  v_gateway_type := case upper(coalesce(p_price_currency, 'BRL'))
    when 'EUR' then 'transfer_manual_eur'
    when 'USD' then 'transfer_manual_usd'
    else 'pix_manual'
  end;

  -- ✅ p_whatsapp_status = 'na' quando o admin já decidiu NÃO enviar
  -- WhatsApp (toggle desligado) — grava direto no insert pra Auditoria
  -- mostrar "Não se Aplica" (em vez de "Aguardando" para sempre, já que
  -- essa linha nasce concluída e não existe um passo futuro que vá
  -- preenchê-la). Quando o envio for de fato tentado, fica NULL aqui e
  -- update_whatsapp_status grava 'sent'/'error' depois, como sempre.
  insert into public.client_portal_payments (
    tenant_id, client_id, gateway_type, payment_method, payment_type,
    period, plan_label, price_amount, plan_price_amount, price_currency,
    new_vencimento, status, fulfillment_status, fulfilled_at, whatsapp_status
  ) values (
    p_tenant_id, p_client_id, v_gateway_type, 'manual', 'subscription',
    p_period, p_plan_label, p_price_amount, p_price_amount,
    coalesce(p_price_currency, 'BRL'),
    p_new_vencimento, 'manual_approved', 'manual_done', now(), p_whatsapp_status
  )
  returning id into v_id;

  return v_id;
end;
$function$;
