import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

function parseMpSignature(sig: string) {
  // ex: "ts=1713386801,v1=abcdef..."
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

  // anti-replay simples (5 min)
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

// evita devolver detalhes internos
function safeMsg(err: unknown) {
  const s = String((err as any)?.message ?? err ?? "");
  return s.length > 140 ? s.slice(0, 140) + "…" : s;
}

const PERIOD_MONTHS: Record<string, number> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    // MP envia: { type: "payment", action: "payment.updated", data: { id: "123" } }
    if (body?.type !== "payment") {
      return NextResponse.json({ ok: true });
    }

const paymentId = body?.data?.id ? String(body.data.id) : "";
if (!paymentId) return NextResponse.json({ ok: true });

// ✅ valida assinatura do MP
if (!verifyMpWebhook(req, paymentId)) {
  // não vaza detalhes
  return NextResponse.json({ ok: false }, { status: 401 });
}


    // 1) Buscar pagamento pendente no nosso banco
    const { data: payment, error: payErr } = await supabaseAdmin
      .from("client_portal_payments")
      .select("id, tenant_id, client_id, mp_payment_id, status, period, plan_label, price_amount, price_currency, new_vencimento")
      .eq("mp_payment_id", paymentId)
      .in("status", ["pending", "processing"]) // permite reentrada segura
      .single();

    if (payErr || !payment) {
      // não é um pagamento nosso / já finalizado
      return NextResponse.json({ ok: true });
    }

    // 2) Descobrir gateway MP ativo do tenant (para consultar status real no MP)
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

    // se não tem gateway, não tem como validar no MP — não processa
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
      // não falha webhook (MP pode reenviar)
      return NextResponse.json({ ok: true });
    }

    // Se ainda não aprovado: só atualiza status final ruim (rejected/cancelled etc)
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

    // 4) Lock atômico: pending -> processing (se já lockou, sai)
    const { data: locked, error: lockErr } = await supabaseAdmin
      .from("client_portal_payments")
      .update({ status: "processing" })
      .eq("id", payment.id)
      .eq("status", "pending")
      .select("id");

    if (lockErr) {
      return NextResponse.json({ ok: true });
    }

    // se não atualizou ninguém, outra execução já pegou
    if (!locked || (Array.isArray(locked) && locked.length === 0)) {
      return NextResponse.json({ ok: true });
    }

    
    
    // 5) Buscar dados do cliente
    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", payment.client_id)
      .single();

    if (!client) {
      // marca aprovado mas sem fulfillment (front vai orientar suporte)
      await supabaseAdmin
        .from("client_portal_payments")
        .update({ status: "approved", new_vencimento: null })
        .eq("id", payment.id);
      return NextResponse.json({ ok: true });
    }

    // ✅ O Webhook DEVE apenas atualizar o status do pagamento para APPROVED.
    // Ele NUNCA deve acionar a API da NaTV/FAST aqui, senão dá duplicidade com o payment-status!
    await supabaseAdmin
      .from("client_portal_payments")
      .update({
        status: "approved"
        // NÃO definimos fulfillment_status aqui. Ele continua "pending" para o sistema processar.
      })
      .eq("id", payment.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: safeMsg(err) }, { status: 200 });
  }
}

// GET para testar se webhook está ativo
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Webhook Mercado Pago ativo",
    timestamp: isoNow(),
  });
}
