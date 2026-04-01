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
// ✅ NOVO
await sendSaasWhatsApp({
  sellerTenantId,
  buyerTenantId,
  paymentType: "renewal",
  newExpiresAt,
  priceAmount: Number(payment.price_amount),
  period: String(payment.period || "MONTHLY"),
});

  } else if (payment.payment_type === "credits") {
    /* 1. BUSCA ROBUSTA: O erro inicial de travar a compra é porque o 'credits_amount' 
      provavelmente vinha zerado/nulo dependendo do checkout.
    */
    const credits = Number(payment.credits_amount || payment.credits || payment.quantidade || payment.amount || 0);
    
    if (credits <= 0) {
      throw new Error(`Quantidade de créditos inválida. Payload recebido: ${JSON.stringify(payment)}`);
    }

    /* 2. REGRA DO SUPERADMIN E FINANCEIRO: 
      Você tem toda a razão na sua análise! O SuperAdmin tem crédito infinito e o 
      registro financeiro tem que ir sempre para a conta do pai (seller).
      
      PORÉM, como o seu código TS aciona uma função interna do banco de dados (RPC), 
      essa inteligência e o lançamento no financeiro do pai precisam estar escritos 
      LÁ DENTRO da função 'saas_purchase_credits_paid' no Supabase.
      
      Se essa função barrar a compra do SuperAdmin, o erro vai estourar aqui.
    */
    const { error } = await supabaseAdmin.rpc("saas_purchase_credits_paid", {
      p_buyer_tenant_id:  buyerTenantId,
      p_seller_tenant_id: sellerTenantId, // O "Pai" (recebedor do dinheiro / vendedor dos créditos)
      p_credits_amount:   credits,
      p_description:      `Compra de ${credits} créditos SaaS · pagamento online`,
      p_price_amount:     Number(payment.price_amount),
      p_price_currency:   String(payment.price_currency || 'BRL'),
    });
    
    if (error) {
      throw new Error(`Falha no banco (saas_purchase_credits_paid): ${error.message}`);
    }

    prodLog("saas_fulfillment.credits_done", {
  buyer: buyerTenantId.slice(-6),
  seller: sellerTenantId.slice(-6),
  credits,
});

// ✅ NOVO
await sendSaasWhatsApp({
  sellerTenantId,
  buyerTenantId,
  paymentType: "credits",
  credits,
  priceAmount: Number(payment.price_amount),
});
  } else {
    throw new Error(`payment_type inválido: ${payment.payment_type}`);
  }

  return { newExpiresAt };
}

// ── ADICIONA após a função prodLog ──────────────────────────

async function sendSaasWhatsApp({
  sellerTenantId,
  buyerTenantId,
  paymentType,
  newExpiresAt,
  credits,
  priceAmount,
  period,
}: {
  sellerTenantId: string;
  buyerTenantId: string;
  paymentType: "renewal" | "credits";
  newExpiresAt?: string | null;
  credits?: number;
  priceAmount?: number;
  period?: string;
}) {
  try {
    const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
    const internalSecret = String(process.env.INTERNAL_API_SECRET || "").trim();
    if (!appUrl || !internalSecret) return;

    // Busca o template do pai para SaaS
    const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(supabaseUrl, serviceKey);

    // Busca template de renovação ou créditos do pai
    const keyword = paymentType === "renewal" ? "saas pagamento realizado" : "saas recarga";
    const keyword2 = paymentType === "renewal" ? "saas renov" : "recarga saas";

    const { data: templates } = await sb
      .from("message_templates")
      .select("id, content, image_url")
      .eq("tenant_id", sellerTenantId)
      .order("name", { ascending: true });

    const tpl = (templates || []).find((t: any) =>
      t.content && (
        String(t.content).toLowerCase().includes(keyword) ||
        String(t.content).toLowerCase().includes(keyword2)
      )
    ) ?? (templates || []).find((t: any) =>
      String(t.name || "").toLowerCase().includes(keyword) ||
      String(t.name || "").toLowerCase().includes(keyword2)
    );

    if (!tpl?.content) {
      prodLog("saas_whatsapp.no_template", { seller: sellerTenantId.slice(-6), paymentType });
      return;
    }

    const periodLabel: Record<string, string> = {
      MONTHLY: "Mensal", BIMONTHLY: "Bimestral", QUARTERLY: "Trimestral",
      SEMIANNUAL: "Semestral", ANNUAL: "Anual",
    };

    const body: Record<string, any> = {
      tenant_id: sellerTenantId,
      saas_id: buyerTenantId,
      message: tpl.content,
      message_template_id: tpl.id,
      image_url: tpl.image_url || null,
      last_invoice_amount: priceAmount,
    };

    if (paymentType === "renewal") {
      body.new_expires_at = newExpiresAt;
      body.saas_plan_label = period ? (periodLabel[period] ?? period) : "";
    } else {
      body.credits_recharged = credits;
      body.saas_plan_label = "Créditos Avulsos";
    }

    const res = await fetch(`${appUrl}/api/whatsapp/envio_agora`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": internalSecret,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      prodLog("saas_whatsapp.failed", { status: res.status, body: txt.slice(0, 200) });
    } else {
      prodLog("saas_whatsapp.sent", { buyer: buyerTenantId.slice(-6), paymentType });
    }
  } catch (e: any) {
    prodLog("saas_whatsapp.error", { msg: e?.message });
  }
}