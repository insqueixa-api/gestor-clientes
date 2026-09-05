// app/api/webhooks/fastdepix/route.ts
// ✅ 04/09/2026 — webhook do FastDePix (FastPay/FastFlow/DePix). Mesmo
// desenho do webhook do Mercado Pago (mercadopago/route.ts): valida
// assinatura, RECONSULTA o status real na API (nunca confia só no corpo do
// webhook) e só então roda o fulfillment. Payload de transação é "JSON
// plano" sem um campo "event" (só med.created tem) — o próprio campo
// status do body já diz o que aconteceu; "paid" é o status que realmente
// significa dinheiro confirmado (equivalente ao "approved" do Mercado
// Pago) — "approved" no FastDePix só significa "passou no compliance/
// anti-fraude, pronto pra ser enviado", ainda não é a confirmação final.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { verifyFastDepixSignature } from "@/lib/webhook-signatures";
import { getFastDepixTransaction, isFastDepixGatewayType } from "@/lib/fastdepix";
import {
  runFulfillment as runIptvFulfillment,
  markFulfillmentDone as markIptvDone,
  markFulfillmentError as markIptvError,
  tryAcquireFulfillmentLock as tryAcquireIptvLock,
  markAppRenewalPaid,
  prodLog,
} from "@/lib/client-portal/fulfillment";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function safeMsg(err: unknown) {
  const s = String((err as any)?.message ?? err ?? "");
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const body = JSON.parse(rawBody || "{}");

    const transactionId = body?.transaction_id ? String(body.transaction_id) : "";
    if (!transactionId) return NextResponse.json({ ok: true });

    prodLog("fastdepix_webhook.received", { transaction_id_suffix: transactionId.slice(-6) });

    const { data: iptvPayment } = await supabaseAdmin
      .from("client_portal_payments")
      .select("id, tenant_id, client_id, mp_payment_id, status, fulfillment_status, period, plan_label, price_amount, plan_price_amount, price_currency, new_vencimento, settled_alert_ids, coupon_id, coupon_discount_amount, payment_type, bundled_app_renewals, gateway_type, payment_method")
      .eq("mp_payment_id", transactionId)
      .maybeSingle();

    if (!iptvPayment) return NextResponse.json({ ok: true });
    if (iptvPayment.fulfillment_status === "done") return NextResponse.json({ ok: true });
    if (!isFastDepixGatewayType(iptvPayment.gateway_type)) return NextResponse.json({ ok: true });

    prodLog("fastdepix_webhook.payment_found", { payment_row: String(iptvPayment.id).slice(-6) });

    const { data: gateways } = await supabaseAdmin
      .from("payment_gateways")
      .select("config")
      .eq("tenant_id", iptvPayment.tenant_id)
      .eq("type", iptvPayment.gateway_type)
      .eq("is_active", true)
      .eq("is_online", true)
      .order("priority", { ascending: true })
      .limit(1);

    const gwConfig = gateways?.[0]?.config || {};
    const webhookSecret = String(gwConfig.webhook_secret || "").trim();
    const signatureHeader = req.headers.get("x-webhook-signature") || "";

    if (!webhookSecret || !verifyFastDepixSignature({ signatureHeader, rawBody, secret: webhookSecret })) {
      prodLog("fastdepix_webhook.sig_failed", { transaction_id_suffix: transactionId.slice(-6) });
      Sentry.captureMessage("fastdepix_webhook_sig_failed", {
        level: "warning",
        tags: { kind: "suspicious_access", reason: "fastdepix_webhook_sig_failed" },
        extra: { transaction_id_suffix: transactionId.slice(-6) },
      });
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const apiKey = String(gwConfig.api_key || "").trim();
    if (!apiKey) return NextResponse.json({ ok: true });

    // ✅ Nunca confia no status do corpo do webhook — reconsulta a transação
    // real na API (mesma defesa em profundidade do webhook do MP).
    let realStatus = "";
    try {
      const tx = await getFastDepixTransaction(apiKey, transactionId);
      realStatus = String(tx.status || "").toLowerCase();
    } catch (e: any) {
      prodLog("fastdepix_webhook.status_check_failed", { message: safeMsg(e) });
      return NextResponse.json({ ok: true });
    }

    if (realStatus !== "paid") {
      // ✅ client_portal_payments_status_chk só aceita pending/approved/
      // rejected/cancelled/manual_approved — o vocabulário do FastDePix não
      // bate 1:1 (expired/refunded não existem no enum), mapeado pro estado
      // negativo mais próximo em vez de tentar gravar um valor que a
      // constraint rejeitaria.
      const statusMap: Record<string, string> = { cancelled: "cancelled", expired: "cancelled", refunded: "rejected" };
      const mapped = statusMap[realStatus];
      if (mapped) {
        await supabaseAdmin.from("client_portal_payments").update({ status: mapped }).eq("id", iptvPayment.id);
      }
      return NextResponse.json({ ok: true });
    }

    const updatePayload: any = { status: "approved" };
    if (!iptvPayment.fulfillment_status) updatePayload.fulfillment_status = "pending";
    await supabaseAdmin.from("client_portal_payments").update(updatePayload).eq("id", iptvPayment.id);

    const origin = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").replace(/\/+$/, "");

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
        } catch (e: any) {
          await markIptvError(supabaseAdmin, iptvPayment.tenant_id, iptvPayment.id, e?.message || "Falha no fulfillment FastDePix");
        }
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err, { tags: { kind: "webhook_handler_error", provider: "fastdepix" } });
    return NextResponse.json({ ok: false, error: safeMsg(err) }, { status: 200 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Webhook FastDePix Portal do Cliente Ativo",
    timestamp: new Date().toISOString(),
  });
}
