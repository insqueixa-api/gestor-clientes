import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import {
  runFulfillment,
  markFulfillmentDone,
  markFulfillmentError,
  tryAcquireFulfillmentLock,
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

// ─── VERIFICAÇÃO DE ASSINATURA ────────────────────────────────────────────────
function parseStripeSig(sig: string) {
  const out: Record<string, string> = {};
  for (const part of sig.split(",")) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return { t: out.t || "", v1: out.v1 || "" };
}

function verifyStripeWebhook(rawBody: string, sig: string, secret: string): boolean {
  const { t, v1 } = parseStripeSig(sig);
  if (!t || !v1) return false;

  const tsNum = Number(t);
  if (!Number.isFinite(tsNum)) return false;

  // Rejeita se o timestamp tiver mais de 5 minutos (protege contra replay attacks)
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
    // ⚠️ OBRIGATÓRIO: req.text() para verificação de assinatura (não req.json())
    const rawBody = await req.text();
    const sig = req.headers.get("stripe-signature") || "";

    if (!sig) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    // Parse antecipado (pré-verificação) apenas para lookup do tenant
    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    // Só processa pagamentos confirmados
    if (event?.type !== "payment_intent.succeeded") {
      return NextResponse.json({ ok: true });
    }

    const paymentIntentId = String(event?.data?.object?.id || "");
    if (!paymentIntentId) return NextResponse.json({ ok: true });

    prodLog("stripe.webhook.received", { pi_suffix: paymentIntentId.slice(-6) });

    // 1) Buscar pagamento no banco pelo PaymentIntent ID
    const { data: payment, error: payErr } = await supabaseAdmin
      .from("client_portal_payments")
      .select(
        "id, tenant_id, client_id, mp_payment_id, status, fulfillment_status, period, plan_label, price_amount, price_currency, new_vencimento"
      )
      .eq("mp_payment_id", paymentIntentId)
      .eq("gateway_type", "stripe")
      .single();

    if (payErr || !payment) {
      // Pagamento não encontrado — ignorar silenciosamente
      return NextResponse.json({ ok: true });
    }

    // Idempotência: se já foi processado, sai
    if (payment.fulfillment_status === "done") {
      return NextResponse.json({ ok: true });
    }

    // 2) Buscar webhook_secret do gateway Stripe deste tenant
    const { data: gateways } = await supabaseAdmin
      .from("payment_gateways")
      .select("config")
      .eq("tenant_id", payment.tenant_id)
      .eq("type", "stripe")
      .eq("is_active", true)
      .order("priority", { ascending: true })
      .limit(1);

    const webhookSecret = String(gateways?.[0]?.config?.webhook_secret || "").trim();

    // 3) Verificar assinatura (se o tenant configurou o webhook_secret)
    if (webhookSecret) {
      if (!verifyStripeWebhook(rawBody, sig, webhookSecret)) {
        prodLog("stripe.webhook.sig_failed", { pi_suffix: paymentIntentId.slice(-6) });
        return NextResponse.json({ ok: false }, { status: 401 });
      }
    }

    prodLog("stripe.webhook.verified", {
      pi_suffix: paymentIntentId.slice(-6),
      tenant: String(payment.tenant_id).slice(-6),
    });

    // 4) Marcar como aprovado e preparar fulfillment
    await supabaseAdmin
      .from("client_portal_payments")
      .update({ status: "approved", fulfillment_status: "pending" })
      .eq("id", payment.id)
      .neq("fulfillment_status", "done"); // nunca sobrescreve um done

    const origin = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").replace(/\/+$/, "");
    if (!origin) return NextResponse.json({ ok: true });

    // 5) Lock + Fulfillment (mesmo padrão do MP)
    const lock = await tryAcquireFulfillmentLock(supabaseAdmin, payment.tenant_id, payment.id);

    prodLog("stripe.webhook.lock_result", {
      acquired: lock.acquired,
      payment_row_id: String(payment.id).slice(-6),
    });

    if (lock.acquired) {
      try {
        const { expDateISO } = await runFulfillment({
          supabaseAdmin,
          tenantId: payment.tenant_id,
          origin,
          payment,
        });
        await markFulfillmentDone(supabaseAdmin, payment.tenant_id, payment.id, expDateISO);
      } catch (e: any) {
        await markFulfillmentError(
          supabaseAdmin,
          payment.tenant_id,
          payment.id,
          e?.message || "Falha no fulfillment via webhook Stripe"
        );
      }
    }

    return NextResponse.json({ ok: true });

  } catch (err) {
    return NextResponse.json({ ok: false, error: safeMsg(err) }, { status: 200 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Webhook Stripe ativo",
    timestamp: isoNow(),
  });
}