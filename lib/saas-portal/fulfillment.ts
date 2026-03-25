import { createClient } from "@supabase/supabase-js";

export interface SaasPaymentFulfillmentParams {
  supabaseAdmin: any;
  payment: any; // saas_portal_payments row
}

function safeLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") console.error(...args);
}

export function prodLog(event: string, meta: Record<string, unknown> = {}) {
  console.log("[SAAS_FULFILLMENT]", JSON.stringify({ ts: new Date().toISOString(), event, ...meta }));
}

// ── Lock ──────────────────────────────────────────────────
export async function tryAcquireSaasLock(
  supabaseAdmin: any,
  tenantId: string,
  paymentRowId: string
) {
  const { data, error } = await supabaseAdmin.rpc(
    "saas_portal_try_acquire_fulfillment_lock",
    { p_tenant_id: tenantId, p_payment_row_id: paymentRowId, p_zombie_seconds: 180 }
  );
  if (error) { safeLog("tryAcquireSaasLock error:", error.message); return { acquired: false }; }
  const acquired = Array.isArray(data) ? !!data[0]?.acquired : !!(data as any)?.acquired;
  return { acquired };
}

// ── Mark done / error ─────────────────────────────────────
export async function markSaasDone(
  supabaseAdmin: any,
  tenantId: string,
  paymentRowId: string,
  newExpiresAt: string | null
) {
  await supabaseAdmin
    .from("saas_portal_payments")
    .update({
      fulfillment_status: "done",
      fulfilled_at: new Date().toISOString(),
      new_expires_at: newExpiresAt,
      fulfillment_error: null,
    })
    .eq("tenant_id", tenantId)
    .eq("id", paymentRowId);
}

export async function markSaasError(
  supabaseAdmin: any,
  tenantId: string,
  paymentRowId: string,
  message: string
) {
  await supabaseAdmin
    .from("saas_portal_payments")
    .update({ fulfillment_status: "error", fulfillment_error: message })
    .eq("tenant_id", tenantId)
    .eq("id", paymentRowId);
}

// ── Main fulfillment ──────────────────────────────────────
export async function runSaasFulfillment(params: SaasPaymentFulfillmentParams) {
  const { supabaseAdmin, payment } = params;
  const buyerTenantId  = String(payment.tenant_id);
  const sellerTenantId = String(payment.parent_tenant_id);

  prodLog("saas_fulfillment.start", {
    buyer: buyerTenantId.slice(-6),
    seller: sellerTenantId.slice(-6),
    type: payment.payment_type,
    amount: payment.price_amount,
    currency: payment.price_currency,
  });

  let newExpiresAt: string | null = null;

  if (payment.payment_type === "renewal") {
    const days = Number(payment.days || 30);
    const { data, error } = await supabaseAdmin.rpc("saas_renew_license_paid", {
      p_buyer_tenant_id:  buyerTenantId,
      p_seller_tenant_id: sellerTenantId,
      p_days:             days,
      p_description:      payment.description || `Renovação automática ${payment.period} · pagamento online`,
      p_price_amount:     Number(payment.price_amount),
      p_price_currency:   String(payment.price_currency),
    });
    if (error) throw new Error(error.message);
    newExpiresAt = data ? String(data) : null;

    prodLog("saas_fulfillment.renewal_done", {
      buyer: buyerTenantId.slice(-6),
      new_expires_at: newExpiresAt,
    });

  } else if (payment.payment_type === "credits") {
    const credits = Number(payment.credits_amount || 0);
    if (credits <= 0) throw new Error("credits_amount inválido");

    const { error } = await supabaseAdmin.rpc("saas_purchase_credits_paid", {
      p_buyer_tenant_id:  buyerTenantId,
      p_seller_tenant_id: sellerTenantId,
      p_credits_amount:   credits,
      p_description:      `Compra de ${credits} créditos SaaS · pagamento online`,
      p_price_amount:     Number(payment.price_amount),
      p_price_currency:   String(payment.price_currency),
    });
    if (error) throw new Error(error.message);

    prodLog("saas_fulfillment.credits_done", {
      buyer: buyerTenantId.slice(-6),
      credits,
    });
  } else {
    throw new Error(`payment_type inválido: ${payment.payment_type}`);
  }

  return { newExpiresAt };
}