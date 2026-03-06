import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  runFulfillment,
  markFulfillmentDone,
  markFulfillmentError,
  tryAcquireFulfillmentLock,
  toPeriodMonths,
} from "@/lib/client-portal/fulfillment";

export const dynamic = "force-dynamic";

// ✅ Nunca cachear respostas do portal
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

// ✅ Log “cego”: em produção não imprime detalhes
function safeServerLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") {
    console.error(...args);
  }
}

function normalizeStr(v: unknown) {
  return String(v ?? "").trim();
}

function isPlausibleSessionToken(t: string) {
  if (t.length < 16 || t.length > 256) return false;
  return /^[a-zA-Z0-9=_\-\.]+$/.test(t);
}

// payment_id pode ser mp id (numérico) OU quoteId (wise etc).
function isPlausiblePaymentId(t: string) {
  if (t.length < 4 || t.length > 80) return false;
  return /^[a-zA-Z0-9=_\-\.]+$/.test(t);
}

function makeSupabaseAdmin() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}




async function fetchPayment(supabaseAdmin: any, tenantId: string, paymentId: string) {
  const { data, error } = await supabaseAdmin
    .from("client_portal_payments")
    .select(
      // ✅ CORREÇÃO: Adicionado fulfillment_started_at
      "id,tenant_id,client_id,mp_payment_id,status,period,plan_label,price_amount,price_currency,new_vencimento,fulfillment_status,fulfillment_error,fulfillment_started_at"
    )
    .eq("tenant_id", tenantId)
    .eq("mp_payment_id", String(paymentId))
    .single();

  if (error) throw error;
  return data as any;
}

async function paymentBelongsToWhatsapp(
  supabaseAdmin: any,
  tenantId: string,
  clientId: string,
  whatsapp: string
) {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", clientId)
    .or(`whatsapp_username.eq.${whatsapp},secondary_whatsapp_username.eq.${whatsapp}`)
    .maybeSingle();

  if (error) return false;
  return !!data?.id;
}

async function refreshMercadoPagoStatusIfNotApproved(
  supabaseAdmin: any,
  tenantId: string,
  payment: any
) {
  const oldStatus = String(payment.status || "").toLowerCase();

  // Só tenta no MP se ainda não aprovado e se parece ser MP
  // (se você quiser travar por gateway_type, inclua gateway_type no select e cheque aqui)
  if (oldStatus === "approved") return { payment, statusChanged: false };

  // Busca gateway ativo do tipo mercadopago
  const { data: gateway, error: gwErr } = await supabaseAdmin
    .from("payment_gateways")
    .select("config")
    .eq("tenant_id", tenantId)
    .eq("type", "mercadopago")
    .eq("is_active", true)
    .maybeSingle();

  const mpToken = String(gateway?.config?.access_token || "").trim();
  if (gwErr || !mpToken) {
    return { payment, statusChanged: false };
  }

  try {
    const mpRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${String(payment.mp_payment_id)}`,
      { headers: { Authorization: `Bearer ${mpToken}` } }
    );

    if (!mpRes.ok) return { payment, statusChanged: false };

    const mpData = await mpRes.json().catch(() => ({} as any));
    const newStatus = String(mpData?.status || "").toLowerCase();
    if (!newStatus || newStatus === oldStatus) return { payment, statusChanged: false };

    const { error: upErr } = await supabaseAdmin
      .from("client_portal_payments")
      .update({ status: newStatus })
      .eq("tenant_id", tenantId)
      .eq("id", payment.id);

    if (!upErr) {
      payment.status = newStatus;
      return { payment, statusChanged: true };
    }

    return { payment, statusChanged: false };
  } catch (e) {
    safeServerLog("payment-status: error consulting Mercado Pago", (e as any)?.message);
    return { payment, statusChanged: false };
  }
}








function getAppOrigin() {
  const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").trim();
  if (!appUrl) return "";
  return appUrl.replace(/\/+$/, "");
}



export async function POST(req: NextRequest) {
  const supabaseAdmin = makeSupabaseAdmin();
  if (!supabaseAdmin) {
    safeServerLog("payment-status: Server misconfigured");
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }

  try {
    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    const payment_id = normalizeStr(body?.payment_id);

    if (!session_token || !payment_id) {
      return NextResponse.json({ ok: false, error: "Parâmetros incompletos" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    if (!isPlausibleSessionToken(session_token) || !isPlausiblePaymentId(payment_id)) {
      return NextResponse.json({ ok: false, error: "Sessão inválida" }, { status: 401, headers: NO_STORE_HEADERS });
    }

    // 1) Validar sessão (tenant + whatsapp)
    const { data: sess, error: sErr } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id, whatsapp_username")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sErr || !sess?.tenant_id || !sess?.whatsapp_username) {
      return NextResponse.json({ ok: false, error: "Sessão inválida" }, { status: 401, headers: NO_STORE_HEADERS });
    }

    const tenantId = String(sess.tenant_id);
    const whatsapp = String(sess.whatsapp_username);

    // ✅ origem confiável (evita SSRF por Host header)
    const origin = getAppOrigin();
    if (!origin) {
      safeServerLog("payment-status: missing UNIGESTOR_APP_URL/APP_URL");
      return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
    }

    // 2) Buscar pagamento
    let payment = await fetchPayment(supabaseAdmin, tenantId, String(payment_id));

    // ✅ garante que o pagamento pertence ao mesmo whatsapp da sessão
    const owns = await paymentBelongsToWhatsapp(supabaseAdmin, tenantId, String(payment.client_id), whatsapp);
    if (!owns) {
      return NextResponse.json({ ok: false, error: "Pagamento não encontrado" }, { status: 404, headers: NO_STORE_HEADERS });
    }

    // 3) Atualizar status via MP (se necessário)
    const { payment: refreshed, statusChanged } = await refreshMercadoPagoStatusIfNotApproved(
      supabaseAdmin,
      tenantId,
      payment
    );
    payment = refreshed;

    const status = String(payment.status || "").toLowerCase();
    const fStatus = String(payment.fulfillment_status || "pending").toLowerCase();

    // 4) Ainda aguardando pagamento
    if (status !== "approved") {
      return NextResponse.json(
        {
          ok: true,
          status,
          phase: "awaiting_payment",
          new_vencimento: payment.new_vencimento ?? null,
        },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    // ✅ CORREÇÃO: Se acabou de virar approved AGORA, apenas garante status pending no banco.
    // REMOVEMOS O RETURN para que ele continue descendo e execute a renovação IMEDIATAMENTE.
    if (statusChanged) {
      if (!payment.fulfillment_status) {
        await supabaseAdmin
          .from("client_portal_payments")
          .update({ fulfillment_status: "pending" })
          .eq("tenant_id", tenantId)
          .eq("id", payment.id)
          .is("fulfillment_status", null);
      }
    }

    // 5) Se fulfillment já terminou
    if (fStatus === "done") {
      return NextResponse.json(
        {
          ok: true,
          status: "approved",
          phase: "done",
          new_vencimento: payment.new_vencimento ?? null,
        },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    if (fStatus === "error") {
      return NextResponse.json(
        {
          ok: true,
          status: "rejected",
          phase: "error",
          error: payment.fulfillment_error || "Falha ao concluir renovação. Procure o suporte.",
        },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    // 6) Lógica Zumbi + Se já está processando
    // Se estiver 'processing' há mais de 3 minutos, consideramos travado (zumbi) e tentamos destravar.
    let isZombie = false;
    if (fStatus === "processing") {
      const startedAt = payment.fulfillment_started_at ? new Date(payment.fulfillment_started_at).getTime() : 0;
      
      if ((Date.now() - startedAt) > 3 * 60 * 1000) {
        // Travado há mais de 3 min -> tenta recuperar
        isZombie = true;
        safeServerLog(`Zumbi detectado no pgto ${payment.id}. Tentando recuperar lock.`);
      } else {
        // Ainda está no prazo normal -> apenas informa que está processando
        return NextResponse.json(
          { ok: true, status: "approved", phase: "renewing", fulfillment_status: "processing" },
          { status: 200, headers: NO_STORE_HEADERS }
        );
      }
    }

    // 7) Tentar adquirir lock e processar
    // Se for zumbi, passamos o flag true para forçar a aquisição mesmo estando 'processing'
    const lock = await tryAcquireFulfillmentLock(supabaseAdmin, tenantId, payment.id);
safeServerLog("lock acquired?", lock);

    
if (!lock.acquired) {
  // Não minta "processing" se não conseguiu setar processing no banco.
  // Isso evita a UI ficar eternamente em "Processando..." com DB em pending.
  return NextResponse.json(
    {
      ok: true,
      status: "approved",
      phase: "renewing",
      fulfillment_status: fStatus, // aqui será "pending" (ou o valor real)
    },
    { status: 200, headers: NO_STORE_HEADERS }
  );
}


    // Executa fulfillment
    try {
      const { expDateISO } = await runFulfillment({ supabaseAdmin, tenantId, origin, payment });
      await markFulfillmentDone(supabaseAdmin, tenantId, payment.id, expDateISO);

      return NextResponse.json(
        { ok: true, status: "approved", phase: "done", new_vencimento: expDateISO },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    } catch (e: any) {
      const msg = e?.message || "Falha no fulfillment. Procure o suporte.";
      safeServerLog("payment-status: fulfillment error", msg);
      await markFulfillmentError(supabaseAdmin, tenantId, payment.id, msg);

      return NextResponse.json(
        { ok: true, status: "rejected", phase: "error", error: "Falha ao concluir renovação. Procure o suporte." },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }
  } catch (err: any) {
    safeServerLog("payment-status: unexpected error", err?.message);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

// GET opcional (mantém simples e sem vazar nada)
export async function GET() {
  return NextResponse.json({ ok: true, message: "API payment-status ativa" }, { status: 200, headers: NO_STORE_HEADERS });
}