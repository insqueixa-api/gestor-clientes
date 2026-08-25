// app/api/client-portal/payment-status/route.ts
import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import {
  runFulfillment,
  markFulfillmentDone,
  markFulfillmentError,
  tryAcquireFulfillmentLock,
  toPeriodMonths,
  markAppRenewalPaid,
} from "@/lib/client-portal/fulfillment";
import { touchPortalSession } from "@/lib/client-portal/session";

export const dynamic = "force-dynamic";
// ✅ Cobre as 2 checagens automáticas da Appativa agendadas via after() em
// markAppRenewalPaid (5s + 30s + margem de rede) — não atrasa a resposta
// em si, só mantém a function viva em background depois dela.
export const maxDuration = 60;

// ✅ Nunca cachear respostas do portal
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

// ✅ Log estruturado — sempre ativo (aparece no log de função da Vercel em
// produção). Antes essa função tinha o corpo do "if" vazio e silenciava
// TODO erro/exceção desta rota, inclusive em produção — isso mascarou a
// causa raiz de pagamentos "approved" que nunca terminam o fulfillment
// (nenhum rastro do que falhou entre o status virar approved e o lock ser
// adquirido). Nunca loga o body inteiro do request nem dados sensíveis,
// só os args que cada call site já escolhe passar (mensagens/ids curtos).
function safeServerLog(...args: any[]) {
  console.error("[payment-status]", ...args);
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
      "id,tenant_id,client_id,mp_payment_id,status,period,plan_label,price_amount,plan_price_amount,price_currency,new_vencimento,fulfillment_status,fulfillment_error,fulfillment_started_at,settled_alert_ids,coupon_id,coupon_discount_amount,payment_type,bundled_app_renewals,gateway_type,payment_method"
    )
    .eq("tenant_id", tenantId)
    .eq("mp_payment_id", String(paymentId))
    .single();

  if (error) throw error;
  return data as any;
}

// ✅ Texto (whatsapp_username/secondary, de sempre) OU âncora de telefone
// (ver docs/sql/portal_phone_anchor_hybrid_identity.sql) — sem a âncora, uma
// conta que trocou de whatsapp_username pra um username reservado do
// WhatsApp nunca confirmava o próprio pagamento, mesmo já pago (o polling de
// payment-status caía sempre em "Pagamento não encontrado").
async function paymentBelongsToWhatsapp(
  supabaseAdmin: any,
  tenantId: string,
  clientId: string,
  whatsapp: string,
  phoneAnchor: string | null,
) {
  const { data, error } = await supabaseAdmin.rpc("portal_client_ids_for_identity", {
    p_tenant_id: tenantId,
    p_whatsapp_username: whatsapp,
    p_phone_anchor: phoneAnchor,
  });
  if (error || !data) return false;
  return (data as { id: string }[]).some((r) => r.id === clientId);
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
    Sentry.captureException(e, { tags: { kind: "client_portal_error", route: "payment-status", where: "mp_status_refresh" } });
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
    Sentry.captureMessage("payment-status: Server misconfigured", { level: "error", tags: { kind: "client_portal_error", route: "payment-status" } });
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
      .select("tenant_id, whatsapp_username, phone_anchor")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sErr || !sess?.tenant_id || !sess?.whatsapp_username) {
      return NextResponse.json({ ok: false, error: "Sessão inválida" }, { status: 401, headers: NO_STORE_HEADERS });
    }

    // ✅ Sessão desliza enquanto o cliente fica na tela de pagamento
    // (polling a cada 3s aqui) — sem isso, um PIX que demora pra ser pago
    // podia sobreviver à sessão (30min contados do LOGIN, não da geração do
    // PIX), o polling levava 401 e parava silenciosamente, travando a UI
    // em "aguardando pagamento" mesmo que o pagamento fosse aprovado depois.
    // ✅ Não bloqueia a resposta (mesmo padrão de validatePortalClient em
    // lib/client-portal/session.ts) — bookkeeping, não precisa do round-trip.
    // Especialmente aqui: essa rota é chamada em polling a cada ~3s enquanto
    // o cliente olha o QR code do PIX, é a rota mais batida do portal.
    after(() => touchPortalSession(supabaseAdmin, session_token));

    const tenantId = String(sess.tenant_id);
    const whatsapp = String(sess.whatsapp_username);

    // ✅ origem confiável (evita SSRF por Host header)
    const origin = getAppOrigin();
    if (!origin) {
      safeServerLog("payment-status: missing UNIGESTOR_APP_URL/APP_URL");
      Sentry.captureMessage("payment-status: missing UNIGESTOR_APP_URL/APP_URL", { level: "error", tags: { kind: "client_portal_error", route: "payment-status" } });
      return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
    }

    // 2) Buscar pagamento
    let payment = await fetchPayment(supabaseAdmin, tenantId, String(payment_id));

    // ✅ garante que o pagamento pertence ao mesmo whatsapp da sessão
    const owns = await paymentBelongsToWhatsapp(supabaseAdmin, tenantId, String(payment.client_id), whatsapp, (sess as any).phone_anchor ?? null);
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

    // ✅ Pagamento avulso de licença de app — nunca passa pela lógica de
    // fulfillment de assinatura IPTV abaixo (manual_pending/zumbi/lock/
    // runFulfillment são todos específicos de renovação de assinatura).
    // Só confirma a cobrança e devolve "done".
    if (payment.payment_type === "app_renewal") {
      if (fStatus !== "done") {
        await markAppRenewalPaid(supabaseAdmin, tenantId, payment.id, origin);
      }
      return NextResponse.json(
        { ok: true, status: "approved", phase: "done" },
        { status: 200, headers: NO_STORE_HEADERS }
      );
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

    // ✅ Servidores sem integração (UniGestor) e Elite caem aqui.
    // Pagamento foi confirmado, mas a renovação no painel é manual (suporte humano).
    // O front mostra a tela com ampulheta + "Renovando manualmente..." e NÃO recarrega.
    if (fStatus === "manual_pending") {
      return NextResponse.json(
        {
          ok: true,
          status: "approved",
          phase: "manual_pending",
          fulfillment_error: payment.fulfillment_error ?? null,
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

      // ✅ Re-checa o estado REAL do banco após o fulfillment.
      // O runFulfillment pode ter caído em manual_pending (servidor sem integração ou Elite).
      // Sem essa verificação, retornaríamos phase: "done" e o front faria reload indevido.
      const { data: postFulfillment } = await supabaseAdmin
        .from("client_portal_payments")
        .select("fulfillment_status, fulfillment_error, new_vencimento")
        .eq("tenant_id", tenantId)
        .eq("id", payment.id)
        .single();

      const finalStatus = String(postFulfillment?.fulfillment_status || "").toLowerCase();

      if (finalStatus === "manual_pending") {
        return NextResponse.json(
          {
            ok: true,
            status: "approved",
            phase: "manual_pending",
            fulfillment_error: postFulfillment?.fulfillment_error ?? null,
          },
          { status: 200, headers: NO_STORE_HEADERS }
        );
      }

      // Estado normal: marca como done e responde com novo vencimento.
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
    Sentry.captureException(err, { tags: { kind: "client_portal_error", route: "payment-status" } });
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

// GET opcional (mantém simples e sem vazar nada)
export async function GET() {
  return NextResponse.json({ ok: true, message: "API payment-status ativa" }, { status: 200, headers: NO_STORE_HEADERS });
}