// app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { verifyStripeWebhookSignature } from "@/lib/webhook-signatures";

// ── IMPORTS IPTV ──────────────────────────────────────────────
import {
  runFulfillment as runIptvFulfillment,
  markFulfillmentDone as markIptvDone,
  markFulfillmentError as markIptvError,
  tryAcquireFulfillmentLock as tryAcquireIptvLock,
  markAppRenewalPaid,
  prodLog,
} from "@/lib/client-portal/fulfillment";

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
function verifyStripeSignature(rawBody: string, sig: string, secret: string): boolean {
  return verifyStripeWebhookSignature({ rawBody, signatureHeader: sig, secret });
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
      .select("id, tenant_id, client_id, mp_payment_id, status, fulfillment_status, period, plan_label, price_amount, plan_price_amount, price_currency, new_vencimento, settled_alert_ids, coupon_id, coupon_discount_amount, payment_type, bundled_app_renewals, gateway_type, payment_method")
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

      if (!webhookSecret || !verifyStripeSignature(rawBody, sig, webhookSecret)) {
        prodLog("stripe.webhook.sig_failed", { pi_suffix: paymentIntentId.slice(-6) });
        Sentry.captureMessage("stripe_webhook_sig_failed", {
          level: "warning",
          tags: { kind: "suspicious_access", reason: "stripe_webhook_sig_failed" },
          extra: { pi_suffix: paymentIntentId.slice(-6) },
        });
        return NextResponse.json({ ok: false }, { status: 401 });
      }

      await supabaseAdmin.from("client_portal_payments")
        .update({ status: "approved", fulfillment_status: "pending" })
        .eq("id", iptvPayment.id)
        .neq("fulfillment_status", "done");

      // ✅ Pagamento avulso de licença de app — nunca roda o fulfillment de
      // assinatura IPTV, só marca a cobrança como concluída.
      if (iptvPayment.payment_type === "app_renewal") {
        await markAppRenewalPaid(supabaseAdmin, iptvPayment.tenant_id, iptvPayment.id, origin);
        return NextResponse.json({ ok: true });
      }

      if (origin) {
        const lock = await tryAcquireIptvLock(supabaseAdmin, iptvPayment.tenant_id, iptvPayment.id);
        if (lock.acquired) {
          try {
            const { expDateISO } = await runIptvFulfillment({ supabaseAdmin, tenantId: iptvPayment.tenant_id, origin, payment: iptvPayment });
            await markIptvDone(supabaseAdmin, iptvPayment.tenant_id, iptvPayment.id, expDateISO);
            // (a baixa das pendências e o price_amount correto já são feitos dentro do runFulfillment)
          } catch (e: any) {
            await markIptvError(supabaseAdmin, iptvPayment.tenant_id, iptvPayment.id, e?.message || "Falha no fulfillment Stripe");
          }
        }
      }
      return NextResponse.json({ ok: true });
    }

    // Se o pagamento não existir, devolve OK silencioso.
    return NextResponse.json({ ok: true });

  } catch (err) {
    Sentry.captureException(err, { tags: { kind: "webhook_handler_error", provider: "stripe" } });
    return NextResponse.json({ ok: false, error: safeMsg(err) }, { status: 200 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Webhook Stripe Portal do Cliente Ativo",
    timestamp: isoNow(),
  });
}