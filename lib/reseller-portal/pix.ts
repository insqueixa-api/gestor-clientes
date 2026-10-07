// lib/reseller-portal/pix.ts
// ✅ 07/10/2026: PIX genérico do Portal da Revenda (Mercado Pago / FastFlow /
// FastPay — DePix fica de fora, exige CPF do pagador). Mesma lógica já
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

export type PixData = { gateway_payment_id: string; pix_qr_code: string | null; pix_qr_code_base64: string | null; expires_at: string };

/** Gateways BRL ativos que geram PIX aqui, por prioridade. */
export async function usablePixGateways(admin: SupabaseClient, tenantId: string) {
  const { data } = await admin
    .from("payment_gateways")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("is_online", true)
    .contains("currency", ["BRL"])
    .order("priority", { ascending: true });
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
  },
): Promise<PixData | null> {
  const expiresAt = new Date(Date.now() + PIX_TTL_MS).toISOString();
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
