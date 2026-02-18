import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// ✅ Nunca cachear respostas do portal
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

// ✅ Log “cego”: em produção não imprime detalhes
function safeServerLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") console.error(...args);
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

const MONTHS_BY_PERIOD: Record<string, number> = {
  MONTHLY: 1,
  BIMONTHLY: 2,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

function toPeriodMonths(periodRaw: unknown) {
  const p = String(periodRaw || "").toUpperCase().trim();
  return MONTHS_BY_PERIOD[p] ?? 1;
}

function fmtBRDateFromISO(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

async function fetchPayment(supabaseAdmin: any, tenantId: string, paymentId: string) {
  const { data, error } = await supabaseAdmin
    .from("client_portal_payments")
    .select(
      "id,tenant_id,client_id,mp_payment_id,status,period,plan_label,price_amount,price_currency,new_vencimento,fulfillment_status,fulfillment_error"
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
    .eq("whatsapp_username", whatsapp)
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

async function tryAcquireFulfillmentLock(supabaseAdmin: any, tenantId: string, paymentRowId: string) {
  // Atomiza: só 1 request consegue trocar pending/null -> processing
  const { data, error } = await supabaseAdmin
    .from("client_portal_payments")
    .update({
      fulfillment_status: "processing",
      fulfillment_started_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", paymentRowId)
    .or("fulfillment_status.is.null,fulfillment_status.eq.pending")
    .select("id,fulfillment_status")
    .maybeSingle();

  if (error || !data) return { acquired: false };
  return { acquired: true };
}

async function markFulfillmentDone(
  supabaseAdmin: any,
  tenantId: string,
  paymentRowId: string,
  newVencimentoISO: string
) {
  await supabaseAdmin
    .from("client_portal_payments")
    .update({
      fulfillment_status: "done",
      fulfilled_at: new Date().toISOString(),
      new_vencimento: newVencimentoISO,
      fulfillment_error: null,
    })
    .eq("tenant_id", tenantId)
    .eq("id", paymentRowId);
}

async function markFulfillmentError(supabaseAdmin: any, tenantId: string, paymentRowId: string, message: string) {
  await supabaseAdmin
    .from("client_portal_payments")
    .update({
      fulfillment_status: "error",
      fulfillment_error: message,
    })
    .eq("tenant_id", tenantId)
    .eq("id", paymentRowId);
}

function getAppOrigin() {
  const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").trim();
  if (!appUrl) return "";
  return appUrl.replace(/\/+$/, "");
}

async function runFulfillment(params: {
  supabaseAdmin: any;
  tenantId: string;
  origin: string;
  payment: any;
}) {
  const { supabaseAdmin, tenantId, origin, payment } = params;

  // 1) Carrega cliente
  const { data: client, error: cErr } = await supabaseAdmin
    .from("clients")
    .select("id,tenant_id,display_name,username,server_id,whatsapp_username,price_currency")
    .eq("tenant_id", tenantId)
    .eq("id", payment.client_id)
    .single();

  if (cErr || !client) throw new Error("Cliente não encontrado para renovação.");
  if (!client.server_id || !client.username) throw new Error("Cliente sem server_id/username para renovação.");

  // 2) Descobrir integração do servidor
  const { data: srv, error: sErr } = await supabaseAdmin
    .from("servers")
    .select("id,name,panel_integration")
    .eq("tenant_id", tenantId)
    .eq("id", client.server_id)
    .single();

  if (sErr || !srv) throw new Error("Servidor não encontrado para renovação.");
  if (!srv.panel_integration) throw new Error("Servidor sem integração (panel_integration).");

  const integrationId = String(srv.panel_integration);

  const { data: integ, error: iErr } = await supabaseAdmin
    .from("server_integrations")
    .select("id,provider")
    .eq("tenant_id", tenantId)
    .eq("id", integrationId)
    .single();

  if (iErr || !integ) throw new Error("Integração não encontrada para renovação.");

  const provider = String(integ.provider || "").toUpperCase();
  const months = toPeriodMonths(payment.period);

  // 3) Chamar renew-client (NaTV/FAST) — usa endpoint interno
  const renewPath =
    provider === "FAST" ? "/api/integrations/fast/renew-client" : "/api/integrations/natv/renew-client";

  const internalSecret = String(process.env.INTERNAL_API_SECRET || "").trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (internalSecret) headers["x-internal-secret"] = internalSecret;

const renewRes = await fetch(`${origin}${renewPath}`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    tenant_id: tenantId, // ✅ só para validar no DB (não vai pra NATV)
    integration_id: integrationId,
    username: String(client.username),
    months,
  }),
});


  const renewJson = await renewRes.json().catch(() => null);

  if (!renewRes.ok || !renewJson?.ok) {
    const msg = renewJson?.error || `Falha ao renovar no provedor ${provider}. HTTP ${renewRes.status}`;
    throw new Error(msg);
  }

  const expDateISO = renewJson?.data?.exp_date_iso;
  if (!expDateISO) throw new Error("Integração não retornou exp_date_iso.");

  const newPassword = provider === "NATV" ? (renewJson?.data?.password ?? null) : null;

  // 4) Atualizar cliente
  const updatePayload: any = {
    plan_label: payment.plan_label ?? null,
    price_amount: payment.price_amount ?? null,
    price_currency: payment.price_currency ?? client.price_currency ?? "BRL",
    vencimento: expDateISO,
    updated_at: new Date().toISOString(),
  };

  if (newPassword) updatePayload.server_password = String(newPassword);

  const { error: upClientErr } = await supabaseAdmin
    .from("clients")
    .update(updatePayload)
    .eq("tenant_id", tenantId)
    .eq("id", client.id);

  if (upClientErr) throw new Error(`Falha ao atualizar cliente: ${upClientErr.message}`);

  // 5) Log (best-effort)
  try {
    await supabaseAdmin.from("client_events").insert({
      tenant_id: tenantId,
      client_id: client.id,
      event_type: "RENEWAL",
      message: `Portal: pagamento aprovado e renovação automática via ${srv.name || provider}.`,
      meta: {
        mp_payment_id: String(payment.mp_payment_id),
        months,
        provider,
        server_name: srv.name || null,
        new_vencimento: expDateISO,
      },
    });
  } catch (e) {
    safeServerLog("payment-status: failed to insert client_events", (e as any)?.message);
  }

  // 6) Sync (best-effort)
  try {
    const syncPath = provider === "FAST" ? "/api/integrations/fast/sync" : "/api/integrations/natv/sync";
    await fetch(`${origin}${syncPath}`, { method: "POST", headers, body: JSON.stringify({ integration_id: integrationId }) });
  } catch (e) {
    safeServerLog("payment-status: failed sync", (e as any)?.message);
  }

  // 7) WhatsApp (best-effort) — ✅ mande o x-internal-secret também (se seu endpoint exigir)
  try {
    const vencBR = fmtBRDateFromISO(expDateISO);
    const msg =
      `✅ Pagamento confirmado!\n` +
      `Sua assinatura foi renovada com sucesso.\n` +
      `📅 Novo vencimento: ${vencBR}\n\n` +
      `Se precisar de ajuda, responda esta mensagem.`;

    await fetch(`${origin}/api/whatsapp/envio_agora`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tenant_id: tenantId,
        client_id: client.id,
        message: msg,
        whatsapp_session: "default",
      }),
    });
  } catch (e) {
    safeServerLog("payment-status: failed whatsapp", (e as any)?.message);
  }

  return { expDateISO };
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

    // ✅ Se acabou de virar approved AGORA, devolve rápido pra UI trocar o texto
    if (statusChanged) {
      // opcional: marcar pending se vier null (pra ficar explícito no DB)
      if (!payment.fulfillment_status) {
        await supabaseAdmin
          .from("client_portal_payments")
          .update({ fulfillment_status: "pending" })
          .eq("tenant_id", tenantId)
          .eq("id", payment.id)
          .is("fulfillment_status", null);
      }

      return NextResponse.json(
        {
          ok: true,
          status: "approved",
          phase: "renewing",
          fulfillment_status: "pending",
          new_vencimento: payment.new_vencimento ?? null,
        },
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

    // 6) Se já está processando, mantém UI em “renovando”
    if (fStatus === "processing") {
      return NextResponse.json(
        { ok: true, status: "approved", phase: "renewing", fulfillment_status: "processing" },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    // 7) Tentar adquirir lock e processar
    const lock = await tryAcquireFulfillmentLock(supabaseAdmin, tenantId, payment.id);
    if (!lock.acquired) {
      return NextResponse.json(
        { ok: true, status: "approved", phase: "renewing", fulfillment_status: "processing" },
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
