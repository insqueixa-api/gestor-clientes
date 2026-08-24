// app/api/webhooks/mercadopago/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { verifyMercadoPagoSignature } from "@/lib/webhook-signatures";

// ── IMPORTS IPTV ──────────────────────────────────────────────
import {
  runFulfillment as runIptvFulfillment,
  markFulfillmentDone as markIptvDone,
  markFulfillmentError as markIptvError,
  tryAcquireFulfillmentLock as tryAcquireIptvLock,
  markAppRenewalPaid,
  prodLog
} from "@/lib/client-portal/fulfillment";

function verifyMpWebhook(req: NextRequest, paymentId: string, secret: string) {
  return verifyMercadoPagoSignature({
    signatureHeader: req.headers.get("x-signature") || "",
    requestIdHeader: req.headers.get("x-request-id") || "",
    paymentId,
    secret,
  });
}

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function isoNow() {
  return new Date().toISOString();
}

function safeMsg(err: unknown) {
  const s = String((err as any)?.message ?? err ?? "");
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    if (body?.type !== "payment") {
      return NextResponse.json({ ok: true });
    }

    const paymentId = body?.data?.id ? String(body.data.id) : "";
    if (!paymentId) return NextResponse.json({ ok: true });

    prodLog("webhook.received", { payment_id_suffix: paymentId.slice(-6) });

    // =========================================================================
    // 1) ROTA IPTV (CLIENTES FINAIS)
    // =========================================================================
    const { data: iptvPayment } = await supabaseAdmin
      .from("client_portal_payments")
      .select("id, tenant_id, client_id, mp_payment_id, status, fulfillment_status, period, plan_label, price_amount, plan_price_amount, price_currency, new_vencimento, settled_alert_ids, coupon_id, coupon_discount_amount, payment_type, bundled_app_renewals, gateway_type, payment_method")
      .eq("mp_payment_id", paymentId)
      .maybeSingle();

    if (iptvPayment) {
      if (iptvPayment.fulfillment_status === "done") return NextResponse.json({ ok: true });

      prodLog("webhook.iptv_payment_found", { payment_row: String(iptvPayment.id).slice(-6) });

      const { data: gateways } = await supabaseAdmin
        .from("payment_gateways")
        .select("config")
        .eq("tenant_id", iptvPayment.tenant_id)
        .eq("type", "mercadopago")
        .eq("is_active", true)
        .eq("is_online", true)
        .order("priority", { ascending: true })
        .limit(1);

      const gwConfig = gateways?.[0]?.config || {};
      const webhookSecret = String(gwConfig.webhook_secret || "").trim();

      if (!webhookSecret || !verifyMpWebhook(req, paymentId, webhookSecret)) {
        prodLog("webhook.sig_failed", { payment_id_suffix: paymentId.slice(-6) });
        Sentry.captureMessage("mp_webhook_sig_failed", {
          level: "warning",
          tags: { kind: "suspicious_access", reason: "mp_webhook_sig_failed" },
          extra: { payment_id_suffix: paymentId.slice(-6) },
        });
        return NextResponse.json({ ok: false }, { status: 401 });
      }

      const accessToken = gwConfig.access_token;
      if (!accessToken) return NextResponse.json({ ok: true });

      const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const mpPayment = await mpRes.json().catch(() => ({} as any));
      const mpStatus = String(mpPayment?.status ?? "").toLowerCase();

      if (!mpRes.ok || !mpStatus) return NextResponse.json({ ok: true });

      if (mpStatus !== "approved") {
        const finalBad = ["rejected", "cancelled", "refunded", "charged_back"];
        if (finalBad.includes(mpStatus)) {
          await supabaseAdmin.from("client_portal_payments").update({ status: mpStatus }).eq("id", iptvPayment.id);
        }
        return NextResponse.json({ ok: true });
      }

      // Preparar Fulfillment
      const updatePayload: any = { status: "approved" };
      if (!iptvPayment.fulfillment_status) updatePayload.fulfillment_status = "pending";
      await supabaseAdmin.from("client_portal_payments").update(updatePayload).eq("id", iptvPayment.id);

      const origin = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").replace(/\/+$/, "");

      // ✅ Pagamento avulso de licença de app (payment_type='app_renewal') —
      // NUNCA passa pelo runIptvFulfillment (isso renovaria a assinatura
      // IPTV do cliente, o que não tem nada a ver com pagar a licença de um
      // app). Só marca a cobrança como concluída.
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
    Sentry.captureException(err, { tags: { kind: "webhook_handler_error", provider: "mercadopago" } });
    return NextResponse.json({ ok: false, error: safeMsg(err) }, { status: 200 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Webhook Mercado Pago Portal do Cliente Ativo",
    timestamp: isoNow(),
  });
}
