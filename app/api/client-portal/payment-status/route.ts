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

// ✅ CORREÇÃO: Adicionado parâmetro forceReset para lidar com Zumbis
async function tryAcquireFulfillmentLock(
  supabaseAdmin: any,
  tenantId: string,
  paymentRowId: string
) {
  const { data, error } = await supabaseAdmin.rpc(
    "client_portal_try_acquire_fulfillment_lock",
    {
      p_tenant_id: tenantId,
      p_payment_row_id: paymentRowId,
      p_zombie_seconds: 180,
    }
  );

  if (error) {
    safeServerLog("tryAcquireFulfillmentLock(rpc) error:", error.message);
    return { acquired: false, mode: "rpc_error" };
  }

  // supabase rpc retorna array
  const acquired = Array.isArray(data) ? !!data[0]?.acquired : !!(data as any)?.acquired;
  return { acquired, mode: acquired ? "rpc_acquired" : "rpc_no_match" };
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
// 1) Carrega cliente
const { data: client, error: cErr } = await supabaseAdmin
  .from("clients")
  // ✅ ADICIONADO: server_password, necessário para o Sync da Elite funcionar
  .select("id,tenant_id,display_name,server_username,server_password,external_user_id,technology,server_id,whatsapp_username,price_currency,is_trial")
  .eq("tenant_id", tenantId)
  .eq("id", payment.client_id)
  .single();

  if (cErr || !client) throw new Error("Cliente não encontrado para renovação.");

  const login = String((client as any).server_username || "").trim();
  if (!client.server_id || !login) {
    throw new Error("Cliente sem server_id/server_username para renovação.");
  }

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

  // 3) Chamar renew-client (NaTV/FAST/ELITE) — usa endpoint interno
  let renewPath = "";
  if (provider === "FAST") renewPath = "/api/integrations/fast/renew-client";
  else if (provider === "NATV") renewPath = "/api/integrations/natv/renew-client";
  else if (provider === "ELITE") renewPath = "/api/integrations/elite/renew"; // ✅ ROTA DA ELITE
  else throw new Error(`Provedor não suportado: ${provider}`);

  const internalSecret = String(process.env.INTERNAL_API_SECRET || "").trim();
  if (!internalSecret) throw new Error("INTERNAL_API_SECRET missing");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-internal-secret": internalSecret,
  };

  const payload: any = {
    tenant_id: tenantId,
    integration_id: integrationId,
    username: login,
    months,
  };

  // ✅ Para a Elite, injetamos a tecnologia e o ID numérico que puxamos no passo 1
  if (provider === "ELITE") {
    payload.external_user_id = client.external_user_id || login;
    payload.technology = client.technology || "IPTV";
  }

  const renewRes = await fetch(`${origin}${renewPath}`, {
    method: "POST",
    headers,
    cache: "no-store",
    body: JSON.stringify(payload),
  });

  const renewJson = await renewRes.json().catch(() => null);

  if (!renewRes.ok || !renewJson?.ok) {
    const msg = renewJson?.error || `Falha ao renovar no provedor ${provider}. HTTP ${renewRes.status}`;
    throw new Error(msg);
  }

  // 1. Tenta apanhar a data diretamente da renovação (Fast/NaTV fazem isso)
  let expDateISO = renewJson?.data?.exp_date_iso;
  let newPassword = provider === "NATV" ? (renewJson?.data?.password ?? null) : null;

  // 2. ✅ SEGUNDA CHANCE (Para a Elite): Se a renovação deu OK mas não veio data,
  // chamamos a rota leve de Sync focada em Renovação para buscar a data REAL.
  if (!expDateISO && provider === "ELITE") {
    safeServerLog("[PAYMENT] Elite renovado com sucesso. Aguardando 1.5s para o painel respirar antes do Sync...");
    
    // 👇 DELAY DE SEGURANÇA (1500ms) 👇
    await new Promise(resolve => setTimeout(resolve, 1500));
    // 👆 FIM DO DELAY 👇

    safeServerLog("[PAYMENT] Iniciando Sync de resgate via /renew/sync...");
    
    const syncRes = await fetch(`${origin}/api/integrations/elite/renew/sync`, {
      method: "POST",
      headers, // Usa os mesmos headers (com o x-internal-secret)
      body: JSON.stringify({
        integration_id: integrationId,
        external_user_id: client.external_user_id,
        username: login,
        technology: client.technology,
        tenant_id: tenantId // Passado como medida de segurança extra para o backend
      }),
    });

    const syncJson = await syncRes.json().catch(() => null);

    if (syncRes.ok && syncJson?.ok) {
      expDateISO = syncJson.expires_at_iso || syncJson.exp_date;
      // Se for P2P e o Sync tiver resgatado a palavra-passe atualizada, guardamos
      if (syncJson.password) {
          newPassword = syncJson.password;
      }
      safeServerLog("[PAYMENT] Data resgatada com sucesso via Sync Elite Renovação:", expDateISO);
    }
  }

  // 3. Validação Final: Se mesmo depois do Sync a data não existir, bloqueia.
  if (!expDateISO) {
    throw new Error(`Renovado no provedor ${provider}, mas a nova data de vencimento não foi encontrada após tentativa de sincronização.`);
  }

  // 4) Atualizar cliente
  const updatePayload: any = {
  plan_label: payment.plan_label ?? null,
  price_amount: payment.price_amount ?? null,
  price_currency: payment.price_currency ?? client.price_currency ?? "BRL",
  vencimento: expDateISO,
  updated_at: new Date().toISOString(),
};

// ✅ se era trial, converte para normal
if ((client as any)?.is_trial === true) {
  updatePayload.is_trial = false;
}

if (newPassword) updatePayload.server_password = String(newPassword);

const { error: upClientErr } = await supabaseAdmin
  .from("clients")
  .update(updatePayload)
  .eq("tenant_id", tenantId)
  .eq("id", client.id);

  if (upClientErr) throw new Error(`Falha ao atualizar cliente: ${upClientErr.message}`);

  // --- PREPARANDO VARIÁVEIS PARA OS LOGS ---
  const totalPaid = payment.price_amount != null ? Number(payment.price_amount) : 0;
  const safeCurrency = String(payment.price_currency || client.price_currency || "BRL").toUpperCase().trim();
  const unitPrice = months > 0 ? Number((totalPaid / months).toFixed(2)) : totalPaid;
  const qtyScreens = Number((client as any).screens ?? 1);
  const clientName = String((client as any).display_name || "Cliente").trim();
  
  // ✅ Formata a moeda exatamente igual ao modal do painel (Ex: R$ 30,00)
  const formattedMoney = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: safeCurrency,
  }).format(totalPaid);

  // 5a) Log na Linha do Tempo do Cliente (Limpo, sem o próprio nome e sem servidor)
  try {
    await supabaseAdmin.from("client_events").insert({
      tenant_id: tenantId,
      client_id: client.id,
      event_type: "RENEWAL",
      // Ex: Renovação via Portal do Cliente · 1 mês(es) · 2 tela(s) · R$ 30,00
      message: `Renovação via Portal do Cliente · ${months} mês(es) · ${qtyScreens} tela(s) · ${formattedMoney}`,
      meta: {
        mp_payment_id: String(payment.mp_payment_id),
        months,
        provider,
        server_name: srv.name || null,
        new_vencimento: expDateISO,
        source: "client_portal",
      },
    });
  } catch (e) {
    safeServerLog("payment-status: failed to insert client_events", (e as any)?.message);
  }

  // 5b) Registra em client_renewals para o Dashboard (Com nome do cliente para a view do Admin)
  try {
    const { error: renErr } = await supabaseAdmin.from("client_renewals").insert({
      tenant_id: tenantId,
      client_id: client.id,
      server_id: client.server_id,
      months,
      screens: qtyScreens,
      currency: safeCurrency, 
      unit_price: unitPrice,
      total_amount: totalPaid,
      credits_per_month: 1, 
      credits_used: months * qtyScreens,
      status: "PAID",
      // Ex: Renovação via Portal do Cliente · Rebecca (RebeccaVida) · 1 mês(es) · 2 tela(s) · R$ 30,00 · MP: 12345
      notes: `Renovação via Portal do Cliente · ${clientName} (${login}) · ${months} mês(es) · ${qtyScreens} tela(s) · ${formattedMoney} · MP: ${String(payment.mp_payment_id)}`,
    });

    if (renErr) {
      await supabaseAdmin.from("client_events").insert({
        tenant_id: tenantId,
        client_id: client.id,
        event_type: "SYSTEM",
        message: `[ERRO FINANCEIRO] Falha ao registrar renovação no Servidor: ${renErr.message}`
      });
    }
  } catch (e) {
    safeServerLog("payment-status: failed to insert client_renewals", (e as any)?.message);
  }


  // 6) Sync (best-effort)
  try {
    let syncPath = "";
    if (provider === "FAST") syncPath = "/api/integrations/fast/sync";
    else if (provider === "NATV") syncPath = "/api/integrations/natv/sync";
    else if (provider === "ELITE") syncPath = "/api/integrations/elite/sync"; // ✅ SYNC DA ELITE
    
    if (syncPath) {
      await fetch(`${origin}${syncPath}`, { method: "POST", headers, body: JSON.stringify({ integration_id: integrationId }) });
    }
  } catch (e) {
    safeServerLog("payment-status: failed sync", (e as any)?.message);
  }

    // 7) WhatsApp (best-effort) — usa template "Pagamento Realizado" salvo no banco
  try {
    // ✅ Busca template "pagamento" do tenant
    let msg = "";
    try {
      const { data: tmpl } = await supabaseAdmin
        .from("message_templates")
        .select("content")
        .eq("tenant_id", tenantId)
        .or("name.ilike.%pagamento%,name.ilike.%pago%,name.ilike.%realizado%")
        .order("name", { ascending: true })
        .limit(1)
        .maybeSingle();

      msg = String(tmpl?.content || "").trim();
    } catch (e) {
      safeServerLog("payment-status: failed to fetch message template", (e as any)?.message);
    }

    if (!msg) throw new Error("Template de pagamento não encontrado.");

    const waRes = await fetch(`${origin}/api/whatsapp/envio_agora`, {
      method: "POST",
      headers: {
        ...headers, // já tem Content-Type e x-internal-secret
        Accept: "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        tenant_id: tenantId,
        client_id: client.id,
        message: msg,
        whatsapp_session: "default",
      }),
    });

    const waRaw = await waRes.text();

    if (!waRes.ok) {
      safeServerLog("[WA][envio_agora] HTTP error", {
        status: waRes.status,
        statusText: waRes.statusText,
        // não vaza telefone nem token; só um pedaço da resposta
        body_preview: String(waRaw || "").slice(0, 300),
        tenantId,
        clientId_suffix: String(client.id).slice(-6),
      });
    } else {
      safeServerLog("[WA][envio_agora] ok", {
        tenantId,
        clientId_suffix: String(client.id).slice(-6),
      });
    }
  } catch (e) {
    safeServerLog("payment-status: failed whatsapp (exception)", (e as any)?.message);
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