// lib/reseller-portal/credit-orders.ts
// ✅ 06/10/2026: compra de créditos pelo Portal da Revenda.
//   1. createCreditOrder   → PIX no gateway BRL ativo (Mercado Pago / FastFlow),
//                            valor SEMPRE da Tabela Revenda (pacote exato)
//   2. confirmPaidAndFulfill → chamado pelo webhook (MP/FastDePix) OU pelo
//                            acompanhamento da tela (polling), o que chegar
//                            primeiro: reconsulta o gateway, confere o VALOR
//                            pago e então envia o crédito no painel
//   3. o envio usa lib/integrations/natv-transfer.ts com transferId = id do
//      pedido → no máximo 1 envio por pedido, mesmo com webhook + polling
//      juntos; venda registrada só com crédito confirmado.
// Pedidos ficam em reseller_credit_orders (docs/sql/reseller_credit_orders.sql),
// nunca em client_portal_payments.
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFastDepixTransaction, fetchQrCodeAsBase64, getFastDepixTransaction, isFastDepixGatewayType } from "@/lib/fastdepix";
import { executeNatvCreditTransfer } from "@/lib/integrations/natv-transfer";
import { notify } from "@/lib/notifications/notify";
import { syncIptvRendimentos } from "@/lib/finance/sync-iptv-lancamentos";

const ORDER_TTL_MS = 30 * 60 * 1000;

function appOrigin() {
  return String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "https://unigestor.net.br").replace(/\/+$/, "");
}
const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

function log(event: string, meta: Record<string, unknown>) {
  console.error(`[reseller_credit_order:${event}]`, { kind: "reseller_portal_event", ...meta });
}

export type CreditOrderPix = {
  order_id: string;
  gateway_type: string;
  gateway_name: string;
  has_alternate_gateway: boolean;
  credits: number;
  amount: number;
  pix_qr_code: string | null;
  pix_qr_code_base64: string | null;
  expires_at: string;
};

// ---------------------------------------------------------------------------
// 1) CRIAR
// ---------------------------------------------------------------------------
export async function createCreditOrder(
  admin: SupabaseClient,
  params: { tenantId: string; resellerId: string; resellerServerId: string; credits: number; excludeGatewayType?: string },
): Promise<{ ok: true; pix: CreditOrderPix } | { ok: false; status: number; error: string }> {
  const { tenantId, resellerId, resellerServerId, credits } = params;
  if (!Number.isInteger(credits) || credits <= 0) return { ok: false, status: 400, error: "Pacote inválido." };

  // vínculo é DESTA revenda
  const { data: link } = await admin
    .from("reseller_servers")
    .select("id, server_id, server_username, servers(name)")
    .eq("id", resellerServerId)
    .eq("tenant_id", tenantId)
    .eq("reseller_id", resellerId)
    .maybeSingle();
  if (!link) return { ok: false, status: 404, error: "Servidor não encontrado." };
  const serverName = (link as any).servers?.name || "Servidor";
  const username = String(link.server_username || "").trim();
  if (!username) return { ok: false, status: 400, error: "Seu usuário do painel não está cadastrado — fale com o suporte." };

  // preço SEMPRE do servidor: pacote exato da Tabela Revenda
  const { data: pkg } = await admin
    .from("reseller_credit_packages")
    .select("credits, price_brl")
    .eq("tenant_id", tenantId)
    .eq("server_id", link.server_id)
    .eq("credits", credits)
    .maybeSingle();
  const unitPrice = Number(pkg?.price_brl);
  if (!pkg || !(unitPrice > 0)) return { ok: false, status: 400, error: "Esse pacote não está disponível." };
  const amount = Number((credits * unitPrice).toFixed(2));

  // envio anterior sem confirmação trava novas compras (mesma trava do admin)
  const { data: openTransfer } = await admin
    .from("reseller_credit_transfers")
    .select("id")
    .eq("reseller_server_id", link.id)
    .in("status", ["pending", "unknown"])
    .maybeSingle();
  if (openTransfer) {
    return { ok: false, status: 409, error: "Há uma recarga anterior sendo conferida pelo suporte. Aguarde a confirmação antes de comprar de novo." };
  }

  // pedido pago aguardando o envio → não deixa pagar de novo por cima
  const { data: paidWaiting } = await admin
    .from("reseller_credit_orders")
    .select("id")
    .eq("reseller_server_id", link.id)
    .eq("status", "approved")
    // 'error' = crédito NÃO saiu (suporte resolve) — não bloqueia nova compra
    .in("fulfillment_status", ["pending", "processing", "unknown"])
    .limit(1)
    .maybeSingle();
  if (paidWaiting) {
    return { ok: false, status: 409, error: "Você tem uma compra paga aguardando o envio dos créditos. O suporte já foi avisado." };
  }

  const { data: gateways } = await admin
    .from("payment_gateways")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("is_online", true)
    .contains("currency", ["BRL"])
    .order("priority", { ascending: true });
  // só gateways que geram PIX aqui (DePix exige CPF do pagador — fora)
  const usable = (gateways || []).filter((g: any) => g.type === "mercadopago" || (isFastDepixGatewayType(g.type) && g.type !== "depix"));
  if (!usable.length) return { ok: false, status: 503, error: "Pagamento indisponível no momento — fale com o suporte." };
  const gateway = params.excludeGatewayType ? usable.find((g: any) => g.type !== params.excludeGatewayType) : usable[0];
  if (!gateway) return { ok: false, status: 503, error: "Não há outra forma de pagamento disponível." };

  // reaproveita PIX ainda válido do MESMO pacote no MESMO gateway (evita 2 cobranças)
  const { data: pending } = await admin
    .from("reseller_credit_orders")
    .select("*")
    .eq("reseller_server_id", link.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(5);
  for (const old of pending || []) {
    const sameOrder = old.credits === credits && Math.abs(Number(old.amount_brl) - amount) < 0.01 && old.gateway_type === gateway.type;
    const alive = old.expires_at && new Date(old.expires_at).getTime() > Date.now() + 60 * 1000;
    if (sameOrder && alive && old.gateway_payment_id) {
      const re = await reopenPix(gateway, old);
      if (re) return { ok: true, pix: { ...re, has_alternate_gateway: usable.length > 1, gateway_name: gateway.name } };
    }
    // outro pacote/gateway ainda pagável: cancela antes de gerar o novo (nunca 2 PIX pagáveis)
    if (old.gateway_payment_id) await cancelAtGateway(admin, tenantId, old);
    await admin.from("reseller_credit_orders").update({ status: "cancelled" }).eq("id", old.id).eq("status", "pending");
  }

  const orderId = randomUUID();
  const description = `Créditos ${serverName} — ${credits} cr — ${username}`;
  const expiresAt = new Date(Date.now() + ORDER_TTL_MS).toISOString();
  let gatewayPaymentId = "";
  let qrText: string | null = null;
  let qrBase64: string | null = null;
  let expires = expiresAt;

  if (gateway.type === "mercadopago") {
    const token = String(gateway?.config?.access_token || "").trim();
    if (!token) return { ok: false, status: 500, error: "Pagamento indisponível no momento." };
    const bucket10m = Math.floor(Date.now() / (10 * 60 * 1000));
    const res = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Idempotency-Key": `rescredit-${link.id}-${credits}-${amount.toFixed(2)}-${bucket10m}`,
      },
      body: JSON.stringify({
        transaction_amount: amount,
        description,
        payment_method_id: "pix",
        statement_descriptor: "UNIGESTOR",
        binary_mode: true,
        payer: { email: `revenda-${link.id.slice(0, 8)}@unigestor.net.br`, first_name: username, last_name: "Revenda" },
        notification_url: `${appOrigin()}/api/webhooks/mercadopago`,
        external_reference: orderId,
        additional_info: {
          items: [{ id: link.id, title: description, description: `Compra de ${credits} créditos ${serverName} (revenda ${username})`, quantity: 1, unit_price: amount }],
        },
        metadata: { payment_type: "reseller_credits", tenant_id: tenantId, reseller_server_id: link.id, credits, server_username: username },
        date_of_expiration: expiresAt,
      }),
    });
    const mp = await res.json().catch(() => ({} as any));
    if (!res.ok || !mp?.id) {
      log("mp_create_failed", { status: res.status });
      return { ok: false, status: 502, error: "Falha ao gerar o PIX. Tente de novo." };
    }
    gatewayPaymentId = String(mp.id);
    qrText = mp.point_of_interaction?.transaction_data?.qr_code || null;
    qrBase64 = mp.point_of_interaction?.transaction_data?.qr_code_base64 || null;
  } else {
    const apiKey = String(gateway?.config?.api_key || "").trim();
    if (!apiKey) return { ok: false, status: 500, error: "Pagamento indisponível no momento." };
    try {
      const tx = await createFastDepixTransaction({
        apiKey,
        providerType: gateway.type,
        amount,
        payerName: `${username} (revenda)`,
        notificationUrl: `${appOrigin()}/api/webhooks/fastdepix`,
      });
      gatewayPaymentId = String(tx.id);
      qrText = tx.qr_code_text || null;
      qrBase64 = tx.qr_code ? await fetchQrCodeAsBase64(tx.qr_code) : null;
      if (tx.qr_code_expires_at) expires = tx.qr_code_expires_at;
    } catch (e: any) {
      log("fastdepix_create_failed", { message: e?.message });
      return { ok: false, status: 502, error: "Falha ao gerar o PIX. Tente de novo." };
    }
  }

  const { error: insErr } = await admin.from("reseller_credit_orders").insert({
    id: orderId,
    tenant_id: tenantId,
    reseller_id: resellerId,
    reseller_server_id: link.id,
    server_id: link.server_id,
    credits,
    unit_price: unitPrice,
    amount_brl: amount,
    gateway_id: gateway.id,
    gateway_type: gateway.type,
    gateway_payment_id: gatewayPaymentId,
    status: "pending",
    expires_at: expires,
  });
  if (insErr) {
    log("insert_failed", { message: insErr.message });
    return { ok: false, status: 500, error: "Erro interno." };
  }

  return {
    ok: true,
    pix: {
      order_id: orderId,
      gateway_type: gateway.type,
      gateway_name: gateway.name,
      has_alternate_gateway: usable.length > 1,
      credits,
      amount,
      pix_qr_code: qrText,
      pix_qr_code_base64: qrBase64,
      expires_at: expires,
    },
  };
}

async function reopenPix(gateway: any, order: any): Promise<Omit<CreditOrderPix, "has_alternate_gateway" | "gateway_name"> | null> {
  try {
    if (order.gateway_type === "mercadopago") {
      const token = String(gateway?.config?.access_token || "").trim();
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${order.gateway_payment_id}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok || d?.status !== "pending") return null;
      return {
        order_id: order.id,
        gateway_type: order.gateway_type,
        credits: order.credits,
        amount: Number(order.amount_brl),
        pix_qr_code: d.point_of_interaction?.transaction_data?.qr_code || null,
        pix_qr_code_base64: d.point_of_interaction?.transaction_data?.qr_code_base64 || null,
        expires_at: d.date_of_expiration || order.expires_at,
      };
    }
    const tx = await getFastDepixTransaction(String(gateway?.config?.api_key || ""), order.gateway_payment_id);
    if (String(tx.status || "").toLowerCase() !== "pending") return null;
    return {
      order_id: order.id,
      gateway_type: order.gateway_type,
      credits: order.credits,
      amount: Number(order.amount_brl),
      pix_qr_code: tx.qr_code_text || null,
      pix_qr_code_base64: tx.qr_code ? await fetchQrCodeAsBase64(tx.qr_code) : null,
      expires_at: tx.qr_code_expires_at || order.expires_at,
    };
  } catch {
    return null;
  }
}

async function gatewayConfig(admin: SupabaseClient, tenantId: string, type: string) {
  const { data } = await admin
    .from("payment_gateways")
    .select("config")
    .eq("tenant_id", tenantId)
    .eq("type", type)
    .eq("is_active", true)
    .order("priority", { ascending: true })
    .limit(1);
  return (data?.[0]?.config || {}) as Record<string, any>;
}

async function cancelAtGateway(admin: SupabaseClient, tenantId: string, order: any) {
  if (order.gateway_type !== "mercadopago") return; // FastDePix expira sozinho
  try {
    const cfg = await gatewayConfig(admin, tenantId, "mercadopago");
    await fetch(`https://api.mercadopago.com/v1/payments/${order.gateway_payment_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${String(cfg.access_token || "")}` },
      body: JSON.stringify({ status: "cancelled" }),
    });
  } catch {}
}

// ---------------------------------------------------------------------------
// 2) CONFIRMAR PAGAMENTO (webhook ou polling) + ENVIAR
// ---------------------------------------------------------------------------
type GatewayCheck = { state: "paid"; paidAmount: number } | { state: "pending" } | { state: "dead"; status: "cancelled" | "rejected" };

async function checkAtGateway(admin: SupabaseClient, order: any): Promise<GatewayCheck | null> {
  try {
    const cfg = await gatewayConfig(admin, order.tenant_id, order.gateway_type);
    if (order.gateway_type === "mercadopago") {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${order.gateway_payment_id}`, {
        headers: { Authorization: `Bearer ${String(cfg.access_token || "")}` },
      });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok) return null;
      const st = String(d?.status || "").toLowerCase();
      if (st === "approved") return { state: "paid", paidAmount: Number(d.transaction_amount) };
      if (["rejected", "cancelled", "refunded", "charged_back"].includes(st)) return { state: "dead", status: st === "cancelled" ? "cancelled" : "rejected" };
      return { state: "pending" };
    }
    if (isFastDepixGatewayType(order.gateway_type)) {
      const tx = await getFastDepixTransaction(String(cfg.api_key || ""), order.gateway_payment_id);
      const st = String(tx.status || "").toLowerCase();
      // "paid" = dinheiro confirmado ("approved" lá é só compliance)
      if (st === "paid") return { state: "paid", paidAmount: Number(tx.amount) };
      if (st === "cancelled" || st === "expired") return { state: "dead", status: "cancelled" };
      if (st === "refunded") return { state: "dead", status: "rejected" };
      return { state: "pending" };
    }
  } catch (e: any) {
    log("gateway_check_failed", { message: e?.message });
  }
  return null;
}

/** Reconsulta o gateway; se pago (e no valor certo), marca e envia o crédito. Idempotente. */
export async function confirmPaidAndFulfill(admin: SupabaseClient, orderId: string): Promise<void> {
  const { data: order } = await admin.from("reseller_credit_orders").select("*").eq("id", orderId).maybeSingle();
  if (!order || !order.gateway_payment_id) return;

  if (order.status === "pending") {
    const chk = await checkAtGateway(admin, order);
    if (!chk || chk.state === "pending") return;
    if (chk.state === "dead") {
      await admin.from("reseller_credit_orders").update({ status: chk.status }).eq("id", order.id).eq("status", "pending");
      return;
    }
    // ✅ confere o VALOR pago (nunca envia crédito por um PIX de valor menor)
    if (!(chk.paidAmount >= Number(order.amount_brl) - 0.01)) {
      await admin
        .from("reseller_credit_orders")
        .update({
          status: "approved",
          paid_at: new Date().toISOString(),
          fulfillment_status: "error",
          fulfillment_error: `Valor pago (${brl(chk.paidAmount)}) diferente do pedido (${brl(Number(order.amount_brl))}) — créditos NÃO enviados.`,
        })
        .eq("id", order.id)
        .eq("status", "pending");
      await notifyAdmin(admin, order, "Compra de créditos com valor divergente", `Pedido de ${order.credits} créditos pago com valor diferente. Confira antes de enviar.`);
      return;
    }
    await admin
      .from("reseller_credit_orders")
      .update({ status: "approved", paid_at: new Date().toISOString(), fulfillment_status: "pending" })
      .eq("id", order.id)
      .eq("status", "pending");
  }

  await fulfillCreditOrder(admin, order.id);
}

async function notifyAdmin(admin: SupabaseClient, order: any, title: string, message: string) {
  try {
    await notify({
      tenantId: order.tenant_id,
      type: "fulfillment_error",
      title,
      message,
      link: `/admin/revendedor/${order.reseller_id}`,
      sourceId: order.id,
    });
  } catch {}
}

/** Envia o crédito de um pedido JÁ pago. Trava atômica: só 1 execução por pedido. */
export async function fulfillCreditOrder(admin: SupabaseClient, orderId: string): Promise<void> {
  const { data: claimed } = await admin
    .from("reseller_credit_orders")
    .update({ fulfillment_status: "processing" })
    .eq("id", orderId)
    .eq("status", "approved")
    .eq("fulfillment_status", "pending")
    .select("*")
    .maybeSingle();
  if (!claimed) return; // outro caminho já está enviando / já enviou
  const order = claimed;

  const finish = async (fields: Record<string, unknown>) => {
    await admin.from("reseller_credit_orders").update(fields).eq("id", order.id);
  };

  try {
    const { data: link } = await admin
      .from("reseller_servers")
      .select("id, server_id, server_username, servers(name, panel_integration)")
      .eq("id", order.reseller_server_id)
      .maybeSingle();
    const integrationId = (link as any)?.servers?.panel_integration;
    const { data: integ } = integrationId
      ? await admin.from("server_integrations").select("id, provider, api_token, is_active").eq("id", integrationId).maybeSingle()
      : { data: null as any };
    const token = String(integ?.api_token || "").trim();
    const recipient = String(link?.server_username || "").trim();
    if (!link || !integ || String(integ.provider).toUpperCase() !== "NATV" || integ.is_active === false || !token || !recipient) {
      await finish({ fulfillment_status: "error", fulfillment_error: "Servidor sem integração NaTV ativa — envie os créditos manualmente." });
      await notifyAdmin(admin, order, "Créditos pagos sem envio automático", `Revenda pagou ${order.credits} créditos, mas o envio automático não está disponível. Envie manualmente.`);
      return;
    }

    const out = await executeNatvCreditTransfer(admin, {
      transferId: order.id, // mesmo id do pedido → nunca 2 envios por pedido
      tenantId: order.tenant_id,
      resellerServerId: link.id,
      serverId: link.server_id,
      integrationId: integ.id,
      token,
      recipient,
      amount: order.credits,
      // mesmo formato da Recarga rápida: se ficar "sem confirmação" e o Márcio
      // clicar "Chegou" no admin, a venda é registrada com estes valores
      salePayload: {
        unit_price: Number(order.unit_price),
        currency: "BRL",
        total_brl: Number(order.amount_brl),
        notes: `Portal da Revenda · ${order.credits} créditos · PIX ${order.gateway_type} · pedido ${String(order.id).slice(0, 8)}`,
        order_id: order.id,
      },
      createdBy: null,
    });
    const transfer = out.kind === "repeated" ? out.transfer : "transfer" in out ? out.transfer : null;
    const effective = out.kind === "repeated" ? String(transfer?.status) : out.kind;

    if (effective === "done") {
      const serverName = (link as any).servers?.name || "Servidor";
      const { data: sale } = await admin
        .from("server_credit_sales")
        .insert({
          tenant_id: order.tenant_id,
          server_id: order.server_id,
          reseller_server_id: order.reseller_server_id,
          credits_sold: order.credits,
          unit_price: order.unit_price,
          sale_currency: "BRL",
          total_amount_brl: order.amount_brl,
          payment_method: "PIX",
          notes: `Portal da Revenda · ${order.credits} créditos · ${serverName} · PIX ${order.gateway_type} · pedido ${String(order.id).slice(0, 8)}`,
        })
        .select("id")
        .single();
      await admin.from("reseller_servers").update({ last_recharge_credits: order.credits }).eq("id", order.reseller_server_id);
      await finish({ fulfillment_status: "done", fulfilled_at: new Date().toISOString(), sale_id: sale?.id || null, fulfillment_error: null });
      log("done", { order: String(order.id).slice(0, 8) });
      try {
        await syncIptvRendimentos(admin, order.tenant_id);
      } catch {}
      await sendReceiptWhatsApp(admin, order);
      return;
    }

    if (effective === "unknown" || effective === "pending") {
      await finish({ fulfillment_status: "unknown", fulfillment_error: "Envio sem confirmação do NaTV — conferir no painel (Recarga rápida: Chegou / Não chegou)." });
      await notifyAdmin(admin, order, "Créditos pagos: envio sem confirmação", `Pedido de ${order.credits} créditos pago. O NaTV não confirmou o envio — confira no painel e marque Chegou / Não chegou na Recarga rápida.`);
      return;
    }

    const why =
      out.kind === "failed"
        ? out.message
        : out.kind === "open_conflict"
          ? "Havia outro envio sem confirmação pra essa revenda."
          : String(transfer?.error || "Falha no envio.");
    await finish({ fulfillment_status: "error", fulfillment_error: `${why} — créditos NÃO enviados, enviar manualmente.` });
    await notifyAdmin(admin, order, "Créditos pagos, envio falhou", `Pedido de ${order.credits} créditos pago, mas o envio falhou: ${why}. Envie manualmente.`);
  } catch (e: any) {
    // caiu no meio: NÃO volta pra 'pending' (poderia reenviar) — fica pra conferência
    await finish({ fulfillment_status: "unknown", fulfillment_error: `Erro inesperado no envio: ${e?.message || "erro"} — conferir no painel.` });
    await notifyAdmin(admin, order, "Créditos pagos: erro no envio", `Pedido de ${order.credits} créditos pago. Erro inesperado no envio — confira no painel.`);
  }
}

/** Comprovante pro WhatsApp da revenda (template "Recarga Revenda", igual à Recarga rápida). */
async function sendReceiptWhatsApp(admin: SupabaseClient, order: any) {
  // resultado gravado no pedido → coluna WhatsApp do Log do Portal
  const mark = async (st: "sent" | "error" | "na") => {
    await admin.from("reseller_credit_orders").update({ whatsapp_status: st }).eq("id", order.id);
  };
  try {
    const secret = String(process.env.INTERNAL_API_SECRET || "").trim();
    if (!secret) return await mark("error");
    const { data: tpl } = await admin
      .from("message_templates")
      .select("content")
      .eq("tenant_id", order.tenant_id)
      .ilike("name", "%recarga revenda%")
      .limit(1)
      .maybeSingle();
    if (!tpl?.content) return await mark("na");
    const res = await fetch(`${appOrigin()}/api/whatsapp/envio_agora`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({
        tenant_id: order.tenant_id,
        reseller_id: order.reseller_id,
        reseller_server_id: order.reseller_server_id,
        credits_recharged: order.credits,
        message: tpl.content,
        whatsapp_session: "default",
      }),
      signal: AbortSignal.timeout(20000),
    });
    await mark(res.ok ? "sent" : "error");
  } catch (e: any) {
    log("receipt_failed", { message: e?.message });
    await mark("error").catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// 3) WEBHOOK (chamado pelos webhooks do MP/FastDePix quando o pagamento NÃO é
//    de cliente). A assinatura é validada AQUI com o segredo do gateway do
//    tenant do pedido; o status nunca vem do corpo — é reconsultado.
// ---------------------------------------------------------------------------
export async function handleResellerOrderWebhook(
  admin: SupabaseClient,
  params: { gatewayFamily: "mercadopago" | "fastdepix"; gatewayPaymentId: string; verify: (secret: string) => boolean },
): Promise<"not_found" | "bad_signature" | "ok"> {
  let q = admin.from("reseller_credit_orders").select("id, tenant_id, gateway_type").eq("gateway_payment_id", params.gatewayPaymentId);
  q = params.gatewayFamily === "mercadopago" ? q.eq("gateway_type", "mercadopago") : q.in("gateway_type", ["fastpay", "fastflow"]);
  const { data: order } = await q.maybeSingle();
  if (!order) return "not_found";

  const cfg = await gatewayConfig(admin, order.tenant_id, order.gateway_type);
  const secret = String(cfg.webhook_secret || "").trim();
  if (!secret || !params.verify(secret)) {
    console.error("[reseller_order_webhook_sig_failed]", { kind: "suspicious_access", gateway: order.gateway_type });
    return "bad_signature";
  }
  await confirmPaidAndFulfill(admin, order.id);
  return "ok";
}
