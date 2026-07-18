// app/api/webhooks/mercadopago/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// ── IMPORTS IPTV ──────────────────────────────────────────────
import { 
  runFulfillment as runIptvFulfillment, 
  markFulfillmentDone as markIptvDone, 
  markFulfillmentError as markIptvError, 
  tryAcquireFulfillmentLock as tryAcquireIptvLock, 
  prodLog 
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

function verifyMpWebhook(req: NextRequest, paymentId: string, secret: string) {
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

    prodLog("webhook.received", { payment_id_suffix: paymentId.slice(-6) });

    // =========================================================================
    // 1) ROTA IPTV (CLIENTES FINAIS)
    // =========================================================================
    const { data: iptvPayment } = await supabaseAdmin
      .from("client_portal_payments")
      .select("id, tenant_id, client_id, mp_payment_id, status, fulfillment_status, period, plan_label, price_amount, price_currency, new_vencimento")
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

      if (webhookSecret && !verifyMpWebhook(req, paymentId, webhookSecret)) {
        prodLog("webhook.sig_failed", { payment_id_suffix: paymentId.slice(-6) });
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

      // Preparar Fulfillment IPTV
      const updatePayload: any = { status: "approved" };
      if (!iptvPayment.fulfillment_status) updatePayload.fulfillment_status = "pending";
      await supabaseAdmin.from("client_portal_payments").update(updatePayload).eq("id", iptvPayment.id);

      const origin = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").replace(/\/+$/, "");
      if (origin) {
        const lock = await tryAcquireIptvLock(supabaseAdmin, iptvPayment.tenant_id, iptvPayment.id);
        if (lock.acquired) {
          try {
            const { expDateISO } = await runIptvFulfillment({ supabaseAdmin, tenantId: iptvPayment.tenant_id, origin, payment: iptvPayment });
            await markIptvDone(supabaseAdmin, iptvPayment.tenant_id, iptvPayment.id, expDateISO);
          } catch (e: any) {
            await markIptvError(supabaseAdmin, iptvPayment.tenant_id, iptvPayment.id, e?.message || "Falha no fulfillment");
          }
        }
      }
      return NextResponse.json({ ok: true });
    }

    // =========================================================================
    // 2) PIX RECEBIDO DIRETO NA CONTA (fora do fluxo normal, sem cobrança
    // gerada pelo sistema) — guarda pra revisão na Auditoria de PIX em vez de
    // só ignorar. ?conta=pf|pj identifica qual conta MP recebeu (cada conta
    // tem seu próprio webhook cadastrado no painel do Mercado Pago).
    // =========================================================================
    const contaParam = (req.nextUrl.searchParams.get("conta") || "pj").toLowerCase();
    const origemConta = contaParam === "pf" ? "pf" : "pj";

    const { data: gwRow } = await supabaseAdmin
      .from("payment_gateways")
      .select("tenant_id, config")
      .eq("type", "mercadopago")
      .eq("is_active", true)
      .eq("is_online", true)
      .limit(1)
      .maybeSingle();

    const gwConfigAvulso = (gwRow?.config as any) || {};
    const accessTokenAvulso = gwConfigAvulso.access_token;

    if (gwRow?.tenant_id && accessTokenAvulso) {
      const webhookSecretAvulso = String(gwConfigAvulso.webhook_secret || "").trim();
      if (webhookSecretAvulso && !verifyMpWebhook(req, paymentId, webhookSecretAvulso)) {
        prodLog("webhook.sig_failed_pix_avulso", { payment_id_suffix: paymentId.slice(-6) });
        return NextResponse.json({ ok: false }, { status: 401 });
      }

      const mpResAvulso = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${accessTokenAvulso}` },
      });
      const mpPaymentAvulso = await mpResAvulso.json().catch(() => ({} as any));

      if (mpResAvulso.ok && String(mpPaymentAvulso?.status).toLowerCase() === "approved") {
        const payerDoc = String(mpPaymentAvulso?.payer?.identification?.number || "").replace(/\D/g, "") || null;
        const payerName =
          [mpPaymentAvulso?.payer?.first_name, mpPaymentAvulso?.payer?.last_name]
            .filter(Boolean)
            .join(" ")
            .trim() || null;
        const valor = Number(mpPaymentAvulso?.transaction_amount || 0);
        const dataHora = mpPaymentAvulso?.date_approved || new Date().toISOString();

        const { error: pixErr } = await supabaseAdmin
          .from("mp_pix_recebidos")
          .upsert(
            {
              tenant_id: gwRow.tenant_id,
              origem_conta: origemConta,
              mp_payment_id: paymentId,
              payer_name: payerName,
              payer_document: payerDoc,
              valor,
              data_hora: dataHora,
            },
            { onConflict: "tenant_id,mp_payment_id", ignoreDuplicates: true },
          );
        if (pixErr) prodLog("webhook.pix_avulso_insert_failed", { error: pixErr.message });
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
    message: "Webhook Mercado Pago Portal do Cliente Ativo",
    timestamp: isoNow(),
  });
}