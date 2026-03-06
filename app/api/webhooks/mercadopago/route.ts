import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import {
  runFulfillment,
  markFulfillmentDone,
  markFulfillmentError,
  tryAcquireFulfillmentLock,
} from "@/lib/client-portal/fulfillment";

function parseMpSignature(sig: string) {
  const parts = sig.split(",").map(s => s.trim());
  const out: Record<string, string> = {};
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k && v) out[k.trim()] = v.trim();
  }
  return { ts: out.ts || "", v1: out.v1 || "" };
}

function safeEqualHex(a: string, b: string) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

function verifyMpWebhook(req: NextRequest, paymentId: string) {
  const secret = String(process.env.MERCADOPAGO_WEBHOOK_SECRET || "").trim();
  if (!secret) return false;

  const sig = req.headers.get("x-signature") || "";
  const reqId = req.headers.get("x-request-id") || "";
  if (!sig || !reqId) return false;

  const { ts, v1 } = parseMpSignature(sig);
  if (!ts || !v1) return false;

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > 300) return false;

  const manifest = `id:${paymentId};request-id:${reqId};ts:${ts};`;
  const hmac = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  return safeEqualHex(hmac, v1);
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

    if (!verifyMpWebhook(req, paymentId)) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    // 1) Buscar pagamento pendente no nosso banco
    const { data: payment, error: payErr } = await supabaseAdmin
      .from("client_portal_payments")
      .select("id, tenant_id, client_id, mp_payment_id, status, period, plan_label, price_amount, price_currency, new_vencimento")
      .eq("mp_payment_id", paymentId)
      .in("status", ["pending", "processing"])
      .single();

    if (payErr || !payment) {
      return NextResponse.json({ ok: true });
    }

    // 2) Buscar gateway MP ativo do tenant
    const { data: gateways } = await supabaseAdmin
      .from("payment_gateways")
      .select("id, name, type, config, priority")
      .eq("tenant_id", payment.tenant_id)
      .eq("type", "mercadopago")
      .eq("is_active", true)
      .eq("is_online", true)
      .order("priority", { ascending: true })
      .limit(1);

    const gateway = gateways?.[0] as any;
    const accessToken = gateway?.config?.access_token;

    if (!accessToken) {
      return NextResponse.json({ ok: true });
    }

    // 3) Consultar status no MP (fonte de verdade)
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const mpPayment = await mpRes.json().catch(() => ({} as any));
    const mpStatus = String(mpPayment?.status ?? "").toLowerCase();

    if (!mpRes.ok || !mpStatus) {
      return NextResponse.json({ ok: true });
    }

    // Se não aprovado: atualiza status ruim e sai
    if (mpStatus !== "approved") {
      const finalBad = ["rejected", "cancelled", "refunded", "charged_back"];
      if (finalBad.includes(mpStatus)) {
        await supabaseAdmin
          .from("client_portal_payments")
          .update({ status: mpStatus })
          .eq("id", payment.id);
      }
      return NextResponse.json({ ok: true });
    }

    // 4) Lock atômico: pending -> processing
    const { data: locked, error: lockErr } = await supabaseAdmin
      .from("client_portal_payments")
      .update({ status: "processing" })
      .eq("id", payment.id)
      .eq("status", "pending")
      .select("id");

    if (lockErr) return NextResponse.json({ ok: true });
    if (!locked || (Array.isArray(locked) && locked.length === 0)) {
      return NextResponse.json({ ok: true });
    }

    // 5) Marca approved e executa fulfillment direto
    await supabaseAdmin
      .from("client_portal_payments")
      .update({ status: "approved" })
      .eq("id", payment.id);

    const origin = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").replace(/\/+$/, "");

    if (origin) {
      const lock = await tryAcquireFulfillmentLock(supabaseAdmin, payment.tenant_id, payment.id);

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
            e?.message || "Falha no fulfillment via webhook"
          );
        }
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
    message: "Webhook Mercado Pago ativo",
    timestamp: isoNow(),
  });
}