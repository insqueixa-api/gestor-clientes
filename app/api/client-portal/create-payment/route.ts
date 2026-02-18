import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function makeSupabaseAdmin() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) return null;

  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}


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

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      safeServerLog("create-payment: Server misconfigured");
      return NextResponse.json(
        { ok: false, error: "Erro interno" },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    const body = await req.json().catch(() => ({} as any));


const session_token = normalizeStr(body?.session_token);
const client_id = normalizeStr(body?.client_id);
const period = normalizeStr(body?.period);

// ⚠️ ainda pode vir do front, mas será IGNORADO (opcional: só para log em dev)
const price_amount_raw = body?.price_amount;


    // ✅ validações (sem “oráculo” e sem vazar nada)
if (!session_token || !client_id || !period) {
  return jsonError("Parâmetros incompletos", 400);
}


    if (!isPlausibleSessionToken(session_token)) {
      return jsonError("Sessão inválida", 401);
    }

    if (!isUuid(client_id)) {
      return jsonError("Cliente não encontrado", 404);
    }

    if (!Object.prototype.hasOwnProperty.call(PERIOD_LABELS, period)) {
      return jsonError("Período inválido", 400);
    }

    // 1) Validar sessão
    const { data: sess, error: sessErr } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id, whatsapp_username")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessErr || !sess) {
      safeServerLog("create-payment: invalid/expired session");
      return jsonError("Sessão inválida", 401);
    }

    // 2) Buscar dados do cliente
    // ✅ CRÍTICO: garante que o client_id pertence ao whatsapp da sessão
    const { data: client, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("id, display_name, whatsapp_username, plan_label, price_currency, screens, plan_table_id, price_amount, servers(name)")

      .eq("id", client_id)
      .eq("tenant_id", sess.tenant_id)
      .eq("whatsapp_username", sess.whatsapp_username)
      .single();

    if (clientErr || !client) {
      safeServerLog("create-payment: client not found or not owned");
      return jsonError("Cliente não encontrado", 404);
    }

const planLabel = PERIOD_LABELS[period] || period;
const serverName = (client.servers as any)?.name || "Servidor";
const displayName = client.display_name || "Cliente";
let currency = String(client.price_currency || "BRL").trim() || "BRL";


// ===============================
// 2.1) Calcular preço REAL (server)
// ===============================

// 1) resolve plan_table_id (valida tenant/ativa, senão cai no default BRL)
let planTableId = String((client as any).plan_table_id || "").trim();

// 1) se veio plan_table_id, valida e também pega a moeda real dela
if (planTableId) {
  const { data: pt, error: ptErr } = await supabaseAdmin
    .from("plan_tables")
    .select("id, currency")
    .eq("id", planTableId)
    .eq("tenant_id", sess.tenant_id)
    .eq("is_active", true)
    .maybeSingle();

  if (ptErr || !pt) {
    planTableId = "";
  } else {
    // ✅ moeda do plano é a fonte da verdade
    if (pt.currency) currency = String(pt.currency).trim() || currency;
  }
}

// 2) fallback: tenta default da moeda atual; se não achar e não for BRL, tenta BRL
if (!planTableId) {
  const { data: def1, error: defErr1 } = await supabaseAdmin
    .from("plan_tables")
    .select("id, currency")
    .eq("tenant_id", sess.tenant_id)
    .eq("is_system_default", true)
    .eq("currency", currency)
    .eq("is_active", true)
    .maybeSingle();

  if (def1 && !defErr1) {
    planTableId = String(def1.id);
    if (def1.currency) currency = String(def1.currency).trim() || currency;
  } else if (currency !== "BRL") {
    const { data: def2, error: defErr2 } = await supabaseAdmin
      .from("plan_tables")
      .select("id, currency")
      .eq("tenant_id", sess.tenant_id)
      .eq("is_system_default", true)
      .eq("currency", "BRL")
      .eq("is_active", true)
      .maybeSingle();

    if (!def2 || defErr2) return jsonError("Tabela de preços não encontrada", 404);

    planTableId = String(def2.id);
    currency = "BRL";
  } else {
    return jsonError("Tabela de preços não encontrada", 404);
  }
}


// 2) pega APENAS o período solicitado
const { data: item, error: itemErr } = await supabaseAdmin
  .from("plan_table_items")
  .select(
    `
    period,
    plan_table_item_prices (
      screens_count,
      price_amount
    )
  `
  )
  .eq("plan_table_id", planTableId)
  .eq("period", period)
  .maybeSingle();

if (itemErr || !item) return jsonError("Plano não encontrado", 404);

// 3) calcula preço pelo número de telas
const screens = Number((client as any).screens || 1);

const exact = (item as any).plan_table_item_prices?.find((p: any) => p.screens_count === screens);
const fallback = (item as any).plan_table_item_prices?.find((p: any) => p.screens_count === 1);

let computedPrice =
  exact?.price_amount ??
  (fallback?.price_amount ? Number(fallback.price_amount) * screens : 0);

// 4) override do cliente (mesma regra do seu get-prices)
const clientOverride = Number((client as any).price_amount || 0);
const clientPlanLabel = String((client as any).plan_label || "").trim();

if (clientOverride > 0 && PERIOD_LABELS[period] === clientPlanLabel) {
  computedPrice = clientOverride;
}

computedPrice = Number(computedPrice);

if (!Number.isFinite(computedPrice) || computedPrice <= 0) {
  return jsonError("Valor inválido", 400);
}

// (opcional) log dev se o front mandou um valor diferente
if (process.env.NODE_ENV !== "production" && price_amount_raw != null) {
  const sent = Number(price_amount_raw);
  if (Number.isFinite(sent) && sent > 0 && Math.abs(sent - computedPrice) > 0.009) {
    safeServerLog("create-payment: client sent different price", { sent, computedPrice, period });
  }
}


    // 3) Buscar gateway ativo (prioridade)
    const { data: gateways, error: gwErr } = await supabaseAdmin
      .from("payment_gateways")
      .select("*")
      .eq("tenant_id", sess.tenant_id)
      .eq("is_active", true)
      .eq("is_online", true)
      .contains("currency", [currency])
      .order("priority", { ascending: true });

    if (gwErr) {
      safeServerLog("create-payment: gateways query error", gwErr?.message);
      // ✅ sem vazar detalhe
      return jsonError("Erro interno", 500);
    }

    if (!gateways || gateways.length === 0) {
      // Nenhum gateway online — busca fallback manual
      const { data: manual, error: manErr } = await supabaseAdmin
        .from("payment_gateways")
        .select("*")
        .eq("tenant_id", sess.tenant_id)
        .eq("type", "pix_manual")
        .eq("is_active", true)
        .eq("is_manual_fallback", true)
        .single();

      if (manErr || !manual) {
        return jsonError("Nenhum método de pagamento configurado", 503);
      }

      // Retorna dados do PIX Manual (isso é intencional pro cliente ver)
      return NextResponse.json(
        {
          ok: true,
          payment_method: "manual",
          pix_key: manual.config.pix_key,
          pix_key_type: manual.config.pix_key_type,
          holder_name: manual.config.holder_name,
          bank_name: manual.config.bank_name,
          instructions: manual.config.instructions,
          price_amount: computedPrice,
          currency,
        },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    // 4) Tentar criar pagamento com cada gateway
    let lastError: any = null;

    for (const gateway of gateways) {
      try {
        // ======================
        // MERCADO PAGO (PIX)
        // ======================
        if (gateway.type === "mercadopago") {

const mpToken = String(gateway?.config?.access_token || "").trim();
if (!mpToken) {
  safeServerLog("create-payment: mercadopago missing access_token");
  lastError = "Gateway misconfigured";
  continue;
}


          // ✅ URL do webhook: NÃO use NEXT_PUBLIC_APP_URL aqui
          const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").trim();
          if (!appUrl) {
            safeServerLog("create-payment: missing UNIGESTOR_APP_URL/APP_URL");
            return jsonError("Erro interno", 500);
          }
          const webhookUrl = `${appUrl.replace(/\/+$/, "")}/api/webhooks/mercadopago`;

          // ✅ idempotência com janela (evita duplicar clique, mas permite nova cobrança depois)
          const stableAmount = Number(computedPrice).toFixed(2);
          const bucket10m = Math.floor(Date.now() / (10 * 60 * 1000));
          const idempotencyKey = `${sess.tenant_id}-${client_id}-${period}-${currency}-${stableAmount}-${bucket10m}`;

          const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${mpToken}`,

              "X-Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify({
              transaction_amount: Number(computedPrice),
              description: `${displayName} - Plano ${planLabel} - ${serverName}`,
              payment_method_id: "pix",
              payer: {
                email: `${String(client.whatsapp_username)}@unigestor.net.br`,
                first_name: String(displayName).split(" ")[0],
                last_name: String(displayName).split(" ").slice(1).join(" ") || "Cliente",
              },
              notification_url: webhookUrl,
              metadata: {
                client_id,
                tenant_id: sess.tenant_id,
                period,
                price_amount: Number(computedPrice),
                plan_label: planLabel,
                gateway_id: gateway.id,
                // ✅ NÃO enviar session_token pra fora (risco desnecessário)
              },
              date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            }),
          });


          const mpData = await mpResponse.json().catch(() => ({} as any));

          if (mpResponse.ok && mpData?.id) {
            // ✅ Salvar pagamento pendente (apenas colunas que existem na sua tabela)
            const { data: inserted, error: insErr } = await supabaseAdmin
  .from("client_portal_payments")
  .upsert(
    {
      tenant_id: sess.tenant_id,
      client_id,

      gateway_type: gateway.type,
      payment_method: "online",

      mp_payment_id: String(mpData.id),
      period,
      plan_label: planLabel,
      price_amount: Number(computedPrice),
      price_currency: currency,
      status: "pending",
    },
    { onConflict: "tenant_id,gateway_type,mp_payment_id" }
  )
  .select("id, mp_payment_id")
  .single();

if (insErr || !inserted) {
  safeServerLog("create-payment: upsert payment error", insErr?.message);
  return jsonError("Erro interno", 500);
}


            return NextResponse.json(
              {
                ok: true,
                payment_method: "online",
                gateway_name: gateway.name,

                payment_id: String(mpData.id),
                internal_payment_id: inserted.id,

                pix_qr_code: mpData.point_of_interaction?.transaction_data?.qr_code,
                pix_qr_code_base64: mpData.point_of_interaction?.transaction_data?.qr_code_base64,
                expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
              },
              { status: 200, headers: NO_STORE_HEADERS }
            );
          }

          // ✅ não vaza detalhe do MP
          lastError = "Falha ao criar pagamento no gateway";
          continue;
        }

        // ======================
        // WISE
        // ======================
        if (gateway.type === "wise") {
          const quoteRes = await fetch(
            `https://api.transferwise.com/v3/profiles/${gateway.config.profile_id}/quotes`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${gateway.config.api_token}`,
              },
              body: JSON.stringify({
                sourceCurrency: gateway.config.source_currency || "BRL",
                targetCurrency: currency,
                sourceAmount: Number(computedPrice),
                targetAmount: null,
                payOut: "BALANCE",
              }),
            }
          );

          if (!quoteRes.ok) {
            const quoteErr = await quoteRes.text().catch(() => "");
            safeServerLog("create-payment: Wise quote error", quoteRes.status, quoteErr);
            lastError = "Falha ao criar cotação no gateway";
            continue;
          }

          const quoteData = await quoteRes.json().catch(() => ({} as any));
          const quoteId = quoteData?.id;

          if (!quoteId) {
            lastError = "Falha ao criar cotação no gateway";
            continue;
          }

          const { data: inserted, error: insErr } = await supabaseAdmin
            .from("client_portal_payments")
            .insert({
              tenant_id: sess.tenant_id,
              client_id,

              gateway_type: gateway.type,
              payment_method: "manual",

              mp_payment_id: String(quoteId),
              period,
              plan_label: planLabel,
              price_amount: Number(computedPrice),
              price_currency: currency,
              status: "pending",
            })
            .select("id, mp_payment_id")
            .single();

          if (insErr || !inserted) {
            safeServerLog("create-payment: insert Wise payment error", insErr?.message);
            return jsonError("Erro interno", 500);
          }

          return NextResponse.json(
            {
              ok: true,
              payment_method: "manual",
              gateway_name: gateway.name,
              payment_id: String(quoteId),
              internal_payment_id: inserted.id,
              instructions: `Transferência via Wise

Valor: ${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(computedPrice))}
Taxa estimada: ${new Intl.NumberFormat("en-US", { style: "currency", currency: gateway.config.source_currency || "BRL" }).format(quoteData?.fee ?? 0)}
Você receberá: ${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(quoteData?.targetAmount ?? 0)}

Use o ID da cotação para fazer a transferência no app Wise:
Quote ID: ${quoteId}

Após realizar a transferência, envie o comprovante pelo WhatsApp para confirmar.`,
              quote_id: String(quoteId),
              expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            },
            { status: 200, headers: NO_STORE_HEADERS }
          );
        }
      } catch (err: any) {
        safeServerLog(`create-payment: gateway error (${gateway?.type})`, err?.message);
        lastError = "Falha ao criar pagamento no gateway";
        continue;
      }
    }

    // Todos os gateways falharam — tentar fallback manual
    const { data: manual, error: manErr } = await supabaseAdmin
      .from("payment_gateways")
      .select("*")
      .eq("tenant_id", sess.tenant_id)
      .eq("type", "pix_manual")
      .eq("is_active", true)
      .eq("is_manual_fallback", true)
      .single();

    if (manual && !manErr) {
      return NextResponse.json(
        {
          ok: true,
          payment_method: "manual",
          pix_key: manual.config.pix_key,
          pix_key_type: manual.config.pix_key_type,
          holder_name: manual.config.holder_name,
          bank_name: manual.config.bank_name,
          instructions: manual.config.instructions,
          price_amount: computedPrice,
          currency,
        },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    // ✅ não vaza “lastError” real
    return jsonError("Erro ao criar pagamento", 500);
  } catch (err: any) {
    safeServerLog("create-payment: unexpected error", err?.message);
    // ✅ não vaza detalhe nenhum
    return NextResponse.json(
      { ok: false, error: "Erro interno" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
