// lib/reseller-portal/pix.ts
// ✅ 07/10/2026: PIX genérico do Portal da Revenda (Mercado Pago / FastFlow /
// FastPay — DePix fica de fora, exige CPF do pagador). ✅ 08/10/2026: + Stripe
// (cartão) pra revenda em USD/EUR — mesmo PaymentIntent do portal do cliente. Mesma lógica já
// validada em lib/reseller-portal/credit-orders.ts (que continua com a cópia
// dela, de propósito, pra não mexer no fluxo de créditos que já funciona);
// usado pelos pedidos de ativação de app (lib/reseller-portal/app-orders.ts).
//   - createPix: cobra no gateway BRL ativo de maior prioridade;
//   - reopenPix: devolve o QR de um PIX ainda pendente (evita 2 cobranças);
//   - cancelPix: cancela no MP (FastDePix expira sozinho);
//   - checkPix: reconsulta o gateway — o status NUNCA vem do navegador nem do
//     corpo do webhook, e o valor pago volta junto pra conferência.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFastDepixTransaction, fetchQrCodeAsBase64, getFastDepixTransaction, isFastDepixGatewayType } from "@/lib/fastdepix";

export const PIX_TTL_MS = 30 * 60 * 1000;

export function appOrigin() {
  return String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "https://unigestor.net.br").replace(/\/+$/, "");
}

export type PixData = {
  gateway_payment_id: string;
  pix_qr_code: string | null;
  pix_qr_code_base64: string | null;
  expires_at: string;
  /** ✅ 08/10/2026: Stripe (revenda USD/EUR) — cartão na tela */
  client_secret?: string | null;
  publishable_key?: string | null;
};

export type ChargeCurrency = "BRL" | "USD" | "EUR";

/** Gateways ativos que cobram aqui, por prioridade. BRL → PIX (MP/FastFlow/FastPay);
 * USD/EUR → Stripe (cartão), mesma regra do portal do cliente. */
export async function usablePixGateways(admin: SupabaseClient, tenantId: string, currency: ChargeCurrency = "BRL") {
  const { data } = await admin
    .from("payment_gateways")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("is_online", true)
    .contains("currency", [currency])
    .order("priority", { ascending: true });
  if (currency !== "BRL") return (data || []).filter((g: any) => g.type === "stripe");
  return (data || []).filter((g: any) => g.type === "mercadopago" || (isFastDepixGatewayType(g.type) && g.type !== "depix"));
}

export async function gatewayConfig(admin: SupabaseClient, tenantId: string, type: string) {
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

export async function createPix(
  gateway: any,
  p: {
    externalRef: string;
    amount: number;
    description: string;
    idempotencyKey: string;
    payerName: string;
    payerEmail: string;
    metadata: Record<string, unknown>;
    currency?: ChargeCurrency;
  },
): Promise<PixData | null> {
  const expiresAt = new Date(Date.now() + PIX_TTL_MS).toISOString();
  if (gateway.type === "stripe") {
    const secretKey = String(gateway?.config?.secret_key || "").trim();
    const publishableKey = String(gateway?.config?.publishable_key || "").trim();
    if (!secretKey || !publishableKey) return null;
    const params = new URLSearchParams();
    params.append("amount", String(Math.round(p.amount * 100)));
    params.append("currency", String(p.currency || "EUR").toLowerCase());
    params.append("payment_method_types[]", "card");
    params.append("description", p.description);
    for (const [k, v] of Object.entries({ ...p.metadata, external_ref: p.externalRef })) params.append(`metadata[${k}]`, String(v ?? ""));
    const res = await fetch("https://api.stripe.com/v1/payment_intents", {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": p.idempotencyKey },
      body: params,
    });
    const d = await res.json().catch(() => ({} as any));
    if (!res.ok || !d?.id || !d?.client_secret) return null;
    return { gateway_payment_id: String(d.id), pix_qr_code: null, pix_qr_code_base64: null, expires_at: expiresAt, client_secret: d.client_secret, publishable_key: publishableKey };
  }
  if (gateway.type === "mercadopago") {
    const token = String(gateway?.config?.access_token || "").trim();
    if (!token) return null;
    const res = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Idempotency-Key": p.idempotencyKey },
      body: JSON.stringify({
        transaction_amount: p.amount,
        description: p.description,
        payment_method_id: "pix",
        statement_descriptor: "UNIGESTOR",
        binary_mode: true,
        payer: { email: p.payerEmail, first_name: p.payerName, last_name: "Revenda" },
        notification_url: `${appOrigin()}/api/webhooks/mercadopago`,
        external_reference: p.externalRef,
        additional_info: { items: [{ id: p.externalRef, title: p.description, quantity: 1, unit_price: p.amount }] },
        metadata: p.metadata,
        date_of_expiration: expiresAt,
      }),
    });
    const mp = await res.json().catch(() => ({} as any));
    if (!res.ok || !mp?.id) return null;
    return {
      gateway_payment_id: String(mp.id),
      pix_qr_code: mp.point_of_interaction?.transaction_data?.qr_code || null,
      pix_qr_code_base64: mp.point_of_interaction?.transaction_data?.qr_code_base64 || null,
      expires_at: expiresAt,
    };
  }
  const apiKey = String(gateway?.config?.api_key || "").trim();
  if (!apiKey) return null;
  try {
    const tx = await createFastDepixTransaction({
      apiKey,
      providerType: gateway.type,
      amount: p.amount,
      payerName: `${p.payerName} (revenda)`,
      notificationUrl: `${appOrigin()}/api/webhooks/fastdepix`,
    });
    return {
      gateway_payment_id: String(tx.id),
      pix_qr_code: tx.qr_code_text || null,
      pix_qr_code_base64: tx.qr_code ? await fetchQrCodeAsBase64(tx.qr_code) : null,
      expires_at: tx.qr_code_expires_at || expiresAt,
    };
  } catch {
    return null;
  }
}

export async function reopenPix(gateway: any, gatewayType: string, gatewayPaymentId: string, fallbackExpires: string): Promise<PixData | null> {
  try {
    if (gatewayType === "stripe") {
      const r = await fetch(`https://api.stripe.com/v1/payment_intents/${gatewayPaymentId}`, {
        headers: { Authorization: `Bearer ${String(gateway?.config?.secret_key || "")}` },
      });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok || !["requires_payment_method", "requires_confirmation", "requires_action"].includes(String(d?.status))) return null;
      return {
        gateway_payment_id: gatewayPaymentId,
        pix_qr_code: null,
        pix_qr_code_base64: null,
        expires_at: fallbackExpires,
        client_secret: d.client_secret,
        publishable_key: String(gateway?.config?.publishable_key || "") || null,
      };
    }
    if (gatewayType === "mercadopago") {
      const token = String(gateway?.config?.access_token || "").trim();
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${gatewayPaymentId}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok || d?.status !== "pending") return null;
      return {
        gateway_payment_id: gatewayPaymentId,
        pix_qr_code: d.point_of_interaction?.transaction_data?.qr_code || null,
        pix_qr_code_base64: d.point_of_interaction?.transaction_data?.qr_code_base64 || null,
        expires_at: d.date_of_expiration || fallbackExpires,
      };
    }
    const tx = await getFastDepixTransaction(String(gateway?.config?.api_key || ""), gatewayPaymentId);
    if (String(tx.status || "").toLowerCase() !== "pending") return null;
    return {
      gateway_payment_id: gatewayPaymentId,
      pix_qr_code: tx.qr_code_text || null,
      pix_qr_code_base64: tx.qr_code ? await fetchQrCodeAsBase64(tx.qr_code) : null,
      expires_at: tx.qr_code_expires_at || fallbackExpires,
    };
  } catch {
    return null;
  }
}

export async function cancelPix(admin: SupabaseClient, tenantId: string, gatewayType: string, gatewayPaymentId: string) {
  if (gatewayType === "stripe") {
    try {
      const cfg = await gatewayConfig(admin, tenantId, "stripe");
      await fetch(`https://api.stripe.com/v1/payment_intents/${gatewayPaymentId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${String(cfg.secret_key || "")}` },
      });
    } catch {}
    return;
  }
  if (gatewayType !== "mercadopago") return; // FastDePix expira sozinho
  try {
    const cfg = await gatewayConfig(admin, tenantId, "mercadopago");
    await fetch(`https://api.mercadopago.com/v1/payments/${gatewayPaymentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${String(cfg.access_token || "")}` },
      body: JSON.stringify({ status: "cancelled" }),
    });
  } catch {}
}

export type PixCheck = { state: "paid"; paidAmount: number } | { state: "pending" } | { state: "dead"; status: "cancelled" | "rejected" };

export async function checkPix(admin: SupabaseClient, tenantId: string, gatewayType: string, gatewayPaymentId: string): Promise<PixCheck | null> {
  try {
    const cfg = await gatewayConfig(admin, tenantId, gatewayType);
    if (gatewayType === "stripe") {
      const r = await fetch(`https://api.stripe.com/v1/payment_intents/${gatewayPaymentId}`, {
        headers: { Authorization: `Bearer ${String(cfg.secret_key || "")}` },
      });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok) return null;
      const st = String(d?.status || "").toLowerCase();
      // valor recebido na moeda da cobrança (centavos → unidade)
      if (st === "succeeded") return { state: "paid", paidAmount: Number(d.amount_received ?? d.amount) / 100 };
      if (st === "canceled") return { state: "dead", status: "cancelled" };
      return { state: "pending" };
    }
    if (gatewayType === "mercadopago") {
      const r = await fetch(`https://api.mercadopago.com/v1/payments/${gatewayPaymentId}`, {
        headers: { Authorization: `Bearer ${String(cfg.access_token || "")}` },
      });
      const d = await r.json().catch(() => ({} as any));
      if (!r.ok) return null;
      const st = String(d?.status || "").toLowerCase();
      if (st === "approved") return { state: "paid", paidAmount: Number(d.transaction_amount) };
      if (["rejected", "cancelled", "refunded", "charged_back"].includes(st)) return { state: "dead", status: st === "cancelled" ? "cancelled" : "rejected" };
      return { state: "pending" };
    }
    if (isFastDepixGatewayType(gatewayType)) {
      const tx = await getFastDepixTransaction(String(cfg.api_key || ""), gatewayPaymentId);
      const st = String(tx.status || "").toLowerCase();
      // "paid" = dinheiro confirmado ("approved" lá é só compliance)
      if (st === "paid") return { state: "paid", paidAmount: Number(tx.amount) };
      if (st === "cancelled" || st === "expired") return { state: "dead", status: "cancelled" };
      if (st === "refunded") return { state: "dead", status: "rejected" };
      return { state: "pending" };
    }
  } catch (e: any) {
    console.error("[reseller_pix:check_failed]", { kind: "reseller_portal_event", message: e?.message });
  }
  return null;
}
