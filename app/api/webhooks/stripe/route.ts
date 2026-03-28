import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// ── IMPORTS IPTV ──────────────────────────────────────────────
import {
  runFulfillment as runIptvFulfillment,
  markFulfillmentDone as markIptvDone,
  markFulfillmentError as markIptvError,
  tryAcquireFulfillmentLock as tryAcquireIptvLock,
  prodLog,
} from "@/lib/client-portal/fulfillment";

// ── IMPORTS SAAS ──────────────────────────────────────────────
import { 
  runSaasFulfillment, 
  markSaasDone, 
  markSaasError, 
  tryAcquireSaasLock 
} from "@/lib/saas-portal/fulfillment";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function isoNow() { return new Date().toISOString(); }
function safeMsg(err: unknown) {
  const s = String((err as any)?.message ?? err ?? "");
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
}

// ─── VERIFICAÇÃO DE ASSINATURA STRIPE ─────────────────────────────────────────
function parseStripeSig(sig: string) {
  const out: Record<string, string> = {};
  for (const part of sig.split(",")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return { t: out.t || "", v1: out.v1 || "" };
}

function verifyStripeSignature(rawBody: string, sig: string, secret: string): boolean {
  const { t, v1 } = parseStripeSig(sig);
  if (!t || !v1) return false;

  const tsNum = Number(t);
  if (!Number.isFinite(tsNum)) return false;

  if (Math.abs(Math.floor(Date.now() / 1000) - tsNum) > 300) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`, "utf8")
    .digest("hex");

  if (expected.length !== v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(v1, "utf8"));
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const sig = req.headers.get("stripe-signature") || "";

    if (!sig) return NextResponse.json({ ok: false }, { status: 400 });

    let event: any;
    try { event = JSON.parse(rawBody); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

    if (event?.type !== "payment_intent.succeeded") return NextResponse.json({ ok: true });

    const paymentIntentId = String(event?.data?.object?.id || "");
    if (!paymentIntentId) return NextResponse.json({ ok: true });

    prodLog("stripe.webhook.received", { pi_suffix: paymentIntentId.slice(-6) });
    const origin = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").replace(/\/+$/, "");

    // =========================================================================
    // 1) ROTA IPTV (CLIENTES FINAIS)
    // =========================================================================
    const { data: iptvPayment } = await supabaseAdmin
      .from("client_portal_payments")
      .select("id, tenant_id, client_id, mp_payment_id, status, fulfillment_status, period, plan_label, price_amount, price_currency, new_vencimento")
      .eq("mp_payment_id", paymentIntentId)
      .eq("gateway_type", "stripe")
      .maybeSingle();

    if (iptvPayment) {
      if (iptvPayment.fulfillment_status === "done") return NextResponse.json({ ok: true });

      const { data: gateways } = await supabaseAdmin
        .from("payment_gateways")
        .select("config")
        .eq("tenant_id", iptvPayment.tenant_id)
        .eq("type", "stripe")
        .eq("is_active", true)
        .order("priority", { ascending: true })
        .limit(1);

      const webhookSecret = String(gateways?.[0]?.config?.webhook_secret || "").trim();

      if (webhookSecret) {
        if (!verifyStripeSignature(rawBody, sig, webhookSecret)) {
          prodLog("stripe.webhook.sig_failed", { pi_suffix: paymentIntentId.slice(-6) });
          return NextResponse.json({ ok: false }, { status: 401 });
        }
      }

      await supabaseAdmin.from("client_portal_payments")
        .update({ status: "approved", fulfillment_status: "pending" })
        .eq("id", iptvPayment.id)
        .neq("fulfillment_status", "done");

      if (origin) {
        const lock = await tryAcquireIptvLock(supabaseAdmin, iptvPayment.tenant_id, iptvPayment.id);
        if (lock.acquired) {
          try {
            const { expDateISO } = await runIptvFulfillment({ supabaseAdmin, tenantId: iptvPayment.tenant_id, origin, payment: iptvPayment });
            await markIptvDone(supabaseAdmin, iptvPayment.tenant_id, iptvPayment.id, expDateISO);
          } catch (e: any) {
            await markIptvError(supabaseAdmin, iptvPayment.tenant_id, iptvPayment.id, e?.message || "Falha no fulfillment Stripe");
          }
        }
      }
      return NextResponse.json({ ok: true });
    }

    // =========================================================================
    // 2) ROTA SAAS (REVENDEDORES)
    // =========================================================================
    const { data: saasPayment } = await supabaseAdmin
      .from("saas_portal_payments")
      .select("*")
      .eq("mp_payment_id", paymentIntentId)
      .eq("gateway_type", "stripe")
      .maybeSingle();

    if (saasPayment) {
      if (saasPayment.fulfillment_status === "done") return NextResponse.json({ ok: true });

      // No SaaS, a grana vai pro PAI (parent_tenant_id), então buscamos o gateway DELE
      const { data: gateways } = await supabaseAdmin
        .from("payment_gateways")
        .select("config")
        .eq("tenant_id", saasPayment.parent_tenant_id)
        .eq("type", "stripe")
        .eq("is_active", true)
        .limit(1);

      const webhookSecret = String(gateways?.[0]?.config?.webhook_secret || "").trim();

      if (webhookSecret) {
        if (!verifyStripeSignature(rawBody, sig, webhookSecret)) {
          prodLog("stripe.saas_webhook.sig_failed", { pi_suffix: paymentIntentId.slice(-6) });
          return NextResponse.json({ ok: false }, { status: 401 });
        }
      }

      await supabaseAdmin.from("saas_portal_payments")
        .update({ status: "approved", fulfillment_status: "pending" })
        .eq("id", saasPayment.id)
        .neq("fulfillment_status", "done");

      if (origin) {
        const lock = await tryAcquireSaasLock(supabaseAdmin, saasPayment.tenant_id, saasPayment.id);
        if (lock.acquired) {
          try {
            const { newExpiresAt } = await runSaasFulfillment({ supabaseAdmin, payment: saasPayment });
            await markSaasDone(supabaseAdmin, saasPayment.tenant_id, saasPayment.id, newExpiresAt);

            // ── Disparo WhatsApp do pai para o filho (fire-and-forget) ──
            try {
              const PERIOD_LABELS: Record<string, string> = {
                MONTHLY: "Mensal", BIMONTHLY: "Bimestral", QUARTERLY: "Trimestral",
                SEMIANNUAL: "Semestral", ANNUAL: "Anual",
              };

              const [tenantRes, tmplRes] = await Promise.all([
                supabaseAdmin
                  .from("tenants")
                  .select("auto_whatsapp_session")
                  .eq("id", saasPayment.tenant_id)
                  .maybeSingle(),
                supabaseAdmin
                  .from("message_templates")
                  .select("id, content")
                  .eq("tenant_id", saasPayment.parent_tenant_id)
                  .ilike("name", saasPayment.payment_type === "renewal" ? "%saas pagamento realizado%" : "%saas recarga%")
                  .maybeSingle(),
              ]);

              const waSession = tenantRes.data?.auto_whatsapp_session || "default";
              const template = tmplRes.data;

              if (template?.content) {
                const internalSecret = String(process.env.INTERNAL_API_SECRET || "").trim();

                const waBody: Record<string, any> = {
                  tenant_id: saasPayment.parent_tenant_id,
                  saas_id: saasPayment.tenant_id,
                  message: template.content,
                  message_template_id: template.id,
                  whatsapp_session: waSession,
                  last_invoice_amount: saasPayment.price_amount,
                };

                if (saasPayment.payment_type === "renewal") {
                  waBody.saas_plan_label = PERIOD_LABELS[saasPayment.period] || saasPayment.period || "";
                  if (newExpiresAt) waBody.new_expires_at = newExpiresAt;
                } else if (saasPayment.payment_type === "credits") {
                  waBody.credits_recharged = saasPayment.credits_amount;
                  waBody.saas_plan_label = "Créditos Avulsos";
                }

                await fetch(`${origin}/api/whatsapp/envio_agora`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "x-internal-secret": internalSecret,
                  },
                  body: JSON.stringify(waBody),
                });
              }
            } catch (waErr: any) {
              prodLog("stripe.saas_wa_dispatch_failed", { error: String(waErr?.message || waErr).slice(0, 200) });
            }
            // ── Fim disparo WhatsApp ──

          } catch (e: any) {
            await markSaasError(supabaseAdmin, saasPayment.tenant_id, saasPayment.id, e?.message || "Falha no fulfillment Stripe SaaS");
          }
        }
      }
      return NextResponse.json({ ok: true });
    }

    // Se o pagamento não existir em nenhuma das duas tabelas, devolve OK silencioso.
    return NextResponse.json({ ok: true });

  } catch (err) {
    return NextResponse.json({ ok: false, error: safeMsg(err) }, { status: 200 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Webhook Stripe Unificado (IPTV + SaaS) Ativo",
    timestamp: isoNow(),
  });
}