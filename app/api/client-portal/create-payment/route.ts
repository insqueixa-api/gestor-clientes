// app/api/client-portal/create-payment/route.ts
import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import { notify, formatClientLabel } from "@/lib/notifications/notify";
import { randomUUID } from "crypto";
import { getPendingCharges } from "@/lib/client-portal/pending-charges";
import {
  validateCouponForCharge,
  couponRejectReason,
  checkCouponAbuseGuard,
} from "@/lib/client-portal/coupons";
import { touchPortalSession } from "@/lib/client-portal/session";

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

// ✅ Log estruturado — sempre ativo (aparece no log de função da Vercel em
// produção). Antes o corpo do "if" era vazio e silenciava todo erro desta
// rota mesmo em produção. Nunca loga o body inteiro nem dado sensível, só
// os args que cada call site já escolhe passar.
function safeServerLog(...args: any[]) {
  console.error("[create-payment]", ...args);
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
      Sentry.captureMessage("create-payment: Server misconfigured", { level: "error", tags: { kind: "client_portal_error", route: "create-payment" } });
      return NextResponse.json(
        { ok: false, error: "Erro interno" },
        { status: 500, headers: NO_STORE_HEADERS }
      );
    }

    const body = await req.json().catch(() => ({} as any));


const session_token = normalizeStr(body?.session_token);
const client_id = normalizeStr(body?.client_id);
const period = normalizeStr(body?.period);
const force_manual = body?.force_manual === true;
const coupon_code_raw = normalizeStr(body?.coupon_code);
// ✅ Device ID gerado pelo security.js do MP no front (RenewClient.tsx) —
// opcional, melhora a "Qualidade da Integração" e a taxa de aprovação.
const mp_device_id = normalizeStr(body?.mp_device_id);

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

    // ✅ Não bloqueia a resposta (mesmo padrão de validatePortalClient em
    // lib/client-portal/session.ts) — bookkeeping, não precisa do round-trip.
    after(() => touchPortalSession(supabaseAdmin, session_token));

    // 2) Buscar dados do cliente
    // ✅ CRÍTICO: garante que o client_id pertence ao whatsapp da sessão (Principal ou Secundário)
const { data: client, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("id, display_name, secondary_display_name, whatsapp_username, secondary_whatsapp_username, server_username, plan_label, price_currency, screens, plan_table_id, price_amount, servers(name)")
      .eq("id", client_id)
      .eq("tenant_id", sess.tenant_id)
      .or(`whatsapp_username.eq.${sess.whatsapp_username},secondary_whatsapp_username.eq.${sess.whatsapp_username}`)
      .single();

    if (clientErr || !client) {
      safeServerLog("create-payment: client not found or not owned");
      return jsonError("Cliente não encontrado", 404);
    }

const planLabel = PERIOD_LABELS[period] || period;
const serverName = (client.servers as any)?.name || "Servidor";

// ✅ Se for a Tatiana logada, pega o nome dela pro PIX
const isSecondary = client.secondary_whatsapp_username === sess.whatsapp_username;
const displayName = isSecondary 
  ? (client.secondary_display_name || "Cliente") 
  : (client.display_name || "Cliente");
  
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

// 3) calcula preço pelo número de telas (SEM MULTIPLICAÇÃO)
const screens = Number((client as any).screens || 1);
const clientOverride = Number((client as any).price_amount || 0);
const clientPlanLabel = String((client as any).plan_label || "").trim();

let computedPrice = 0;

const exact = (item as any).plan_table_item_prices?.find(
  (p: any) => p.screens_count === screens
);
const standardPriceForPeriod = exact?.price_amount != null ? Number(exact.price_amount) : null;

// Regra 1: Se o cliente tem um preço fixado (Override) no cadastro E está renovando o mesmo plano
if (clientOverride > 0 && PERIOD_LABELS[period] === clientPlanLabel) {
  computedPrice = clientOverride;
}
// Regra 2: Busca ESTRITAMENTE o valor para esta quantidade exata de telas na tabela
else {
  if (standardPriceForPeriod == null) {
    safeServerLog(`create-payment: preco inexistente para ${screens} telas no periodo ${period}`);
    return jsonError(`Preço não configurado para ${screens} tela(s). Entre em contato com o suporte.`, 400);
  }

  computedPrice = standardPriceForPeriod;
}

if (!Number.isFinite(computedPrice) || computedPrice <= 0) {
  return jsonError("Valor inválido ou zerado.", 400);
}

// (opcional) log dev se o front mandou um valor diferente
if (process.env.NODE_ENV !== "production" && price_amount_raw != null) {
  const sent = Number(price_amount_raw);
  if (Number.isFinite(sent) && sent > 0 && Math.abs(sent - computedPrice) > 0.009) {
    safeServerLog("create-payment: client sent different price", { sent, computedPrice, period });
  }
}

// ===============================
// 2.2) Somar pendências financeiras em aberto (client_alerts com amount)
// Sempre recalculado aqui — nunca confia em nenhum valor vindo do front.
// ✅ planPriceOnly guarda o preço do PLANO sem a pendência — é isso que vira
// o price_amount persistido no cliente depois (senão a próxima renovação
// herdava o valor da pendência de um app como se fosse o preço da
// assinatura, cobrando errado pra sempre).
// ===============================
const planPriceOnly = computedPrice;

// ===============================
// 2.1b) Aplicar cupom de desconto (se informado)
// Sempre recalculado aqui — nunca confia em nenhum valor vindo do front,
// só no código digitado. Desconto incide SOMENTE sobre planPriceOnly,
// nunca sobre pendência (por isso entra ANTES de somar pendingCharges
// abaixo). Se o código vier mas for inválido/expirado/já usado, NÃO
// derruba o pagamento — só ignora o cupom (mesmo espírito fail-open do
// getPendingCharges): o front já validou no clique de "Aplicar" antes de
// chegar aqui, isso só cobre uma corrida entre a prévia e o pagamento.
// ⚠️ couponDiscountAmount NUNCA entra em planPriceOnly — é isso que
// impede o desconto de virar o novo price_amount fixo do cliente lá em
// runFulfillment (mesma proteção que já existe pra pendência).
// ===============================
// price_amount está preenchido pra quase todo cliente (é o preço fixo
// normal dele, não uma flag rara) — "override" de verdade só quando o
// preço do cliente é MENOR que o preço padrão da tabela pra esse
// período/tela. Sem essa comparação, praticamente ninguém seria elegível
// a cupom (mesmo bug já corrigido em impact_preview.ts e
// coupons.ts::findEligibleCoupon nas fases anteriores).
const isOverrideActive =
  clientOverride > 0 &&
  PERIOD_LABELS[period] === clientPlanLabel &&
  standardPriceForPeriod != null &&
  clientOverride < standardPriceForPeriod;
let couponId: string | null = null;
let couponCodeApplied: string | null = null;
let couponDiscountAmount = 0;

if (coupon_code_raw) {
  // ✅ Mesmo rate limit anti-abuso do validate-coupon (achado em auditoria
  // de segurança), escopado por CONTA (client_id, já confirmado dono da
  // sessão lá em cima) — cobre quem chama create-payment direto, pulando
  // a prévia. Bloqueado = ignora o cupom silenciosamente (fail-open,
  // mesmo espírito de "código inválido não derruba o pagamento" abaixo).
  const abuseGuard = await checkCouponAbuseGuard(supabaseAdmin, sess.tenant_id, client_id, coupon_code_raw);

  if (abuseGuard.blocked) {
    safeServerLog("create-payment: coupon blocked by abuse guard", { code: coupon_code_raw });
  } else {
    const { data: couponClientRow } = await supabaseAdmin
      .from("vw_clients_list_active")
      .select(
        "id, computed_status, server_id, plan_name, apps_names, vencimento, created_at, price_currency, price_amount, whatsapp_username",
      )
      .eq("tenant_id", sess.tenant_id)
      .eq("id", client_id)
      .maybeSingle();

    const couponResult = await validateCouponForCharge({
      supabaseAdmin,
      tenantId: sess.tenant_id,
      clientRow: couponClientRow || client,
      code: coupon_code_raw,
      planPriceOnly,
      currency,
      isOverrideActive,
    });

    if (couponResult.ok) {
      couponId = couponResult.coupon.id;
      couponCodeApplied = couponResult.coupon.code;
      couponDiscountAmount = couponResult.discountAmount;
      computedPrice = Number((computedPrice - couponDiscountAmount).toFixed(2));
    } else {
      safeServerLog("create-payment: coupon invalid", { code: coupon_code_raw, reason: couponRejectReason(couponResult) });
    }
  }
}

    // ✅ Pendências financeiras e gateway ativo são independentes entre si
    // (nenhum usa o resultado do outro) — rodavam em sequência, agora juntos.
    const [pendingCharges, gatewaysResult] = await Promise.all([
      getPendingCharges(supabaseAdmin, sess.tenant_id, client_id, currency),
      supabaseAdmin
        .from("payment_gateways")
        .select("*")
        .eq("tenant_id", sess.tenant_id)
        .eq("is_active", true)
        .eq("is_online", true)
        .contains("currency", [currency])
        .order("priority", { ascending: true }),
    ]);
    if (pendingCharges.total > 0) {
      computedPrice = Number((computedPrice + pendingCharges.total).toFixed(2));
    }
    const settledAlertIds = pendingCharges.alertIds.length ? pendingCharges.alertIds : null;

    const { data: gateways, error: gwErr } = gatewaysResult;

    if (gwErr) {
      safeServerLog("create-payment: gateways query error", gwErr?.message);
      Sentry.captureMessage("create-payment: gateways query error", { level: "error", tags: { kind: "client_portal_error", route: "create-payment" }, extra: { message: gwErr?.message } });
      // ✅ sem vazar detalhe
      return jsonError("Erro interno", 500);
    }

    if (!gateways || gateways.length === 0) {
      // Nenhum gateway online — busca fallback manual dinâmico pela moeda
      const { data: manual, error: manErr } = await supabaseAdmin
        .from("payment_gateways")
        .select("*")
        .eq("tenant_id", sess.tenant_id)
        .eq("is_active", true)
        .eq("is_manual_fallback", true)
        .contains("currency", [currency])
        .limit(1)
        .maybeSingle();

      if (manErr || !manual) {
        return jsonError("Nenhum método de pagamento configurado", 503);
      }

      return NextResponse.json(
        {
  ok: true,
  payment_method: "manual",
  price_amount: computedPrice,
  currency,
  ...manual.config,
  gateway_type: manual.type,  // ← sempre por último, nunca sobrescrito
},
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }
// 4a) Se cliente escolheu manual explicitamente, pula gateways online
    if (force_manual) {
      const { data: manual, error: manErr } = await supabaseAdmin
        .from("payment_gateways")
        .select("*")
        .eq("tenant_id", sess.tenant_id)
        .eq("is_active", true)
        .eq("is_manual_fallback", true)
        .contains("currency", [currency])
        .limit(1)
        .maybeSingle();

      if (!manual || manErr) return jsonError("Nenhum método de pagamento manual configurado", 503);

      // ✅ NOVO: cria registro de auditoria para renovação manual escolhida pelo cliente
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("client_portal_payments")
        .insert({
          tenant_id: sess.tenant_id,
          client_id,
          gateway_type: manual.type,
          payment_method: "manual",
          period,
          plan_label: planLabel,
          price_amount: Number(computedPrice),
          plan_price_amount: Number(planPriceOnly),
          price_currency: currency,
          status: "pending",
          fulfillment_status: "awaiting_transfer",
          settled_alert_ids: settledAlertIds,
          coupon_id: couponId,
          coupon_code: couponCodeApplied,
          coupon_discount_amount: couponDiscountAmount > 0 ? couponDiscountAmount : null,
        })
        .select("id")
        .single();

      if (insErr || !inserted) {
        safeServerLog("create-payment: insert manual payment error", insErr?.message);
        Sentry.captureMessage("create-payment: insert manual payment error", { level: "error", tags: { kind: "client_portal_error", route: "create-payment" }, extra: { message: insErr?.message } });
        return jsonError("Erro interno", 500);
      }

      // ✅ NOVO: notificação no sino (tabela notifications)
      await notify({
        tenantId: sess.tenant_id,
        type: "transfer_aguardando",
        title: "🏦 Transferência Aguardando",
        message: `${formatClientLabel(displayName, (client as any).server_username, serverName)} informou que vai transferir ${new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(computedPrice)}. Confirme o recebimento na Auditoria.`,
        link: "/admin/auditoria",
        sourceId: inserted.id,
      });

      // ✅ Email imediato: cliente informou que vai transferir
      try {
        const { sendTransferEmail } = await import("@/lib/notifications/send-transfer-email");
        await sendTransferEmail({
          clientName: displayName,
          serverUsername: String((client as any).server_username || client.whatsapp_username || ""),
          serverName,
          planLabel,
          amount: computedPrice,
          currency,
          mpPaymentId: inserted.id,
        });
      } catch (e: any) {
        console.error("[EMAIL] Falha ao enviar email de transferência:", e?.message);
      }

      return NextResponse.json(
        {
          ok: true,
          payment_method: "manual",
          price_amount: computedPrice,
          currency,
          ...manual.config,
          gateway_type: manual.type,
          internal_payment_id: inserted.id,
        },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    // 4b) Tentar criar pagamento com cada gateway
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
  Sentry.captureMessage("create-payment: mercadopago missing access_token", { level: "error", tags: { kind: "client_portal_error", route: "create-payment" } });
  lastError = "Gateway misconfigured";
  continue;
}


          // ✅ URL do webhook: NÃO use NEXT_PUBLIC_APP_URL aqui
          const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").trim();
          if (!appUrl) {
            safeServerLog("create-payment: missing UNIGESTOR_APP_URL/APP_URL");
            Sentry.captureMessage("create-payment: missing UNIGESTOR_APP_URL/APP_URL", { level: "error", tags: { kind: "client_portal_error", route: "create-payment" } });
            return jsonError("Erro interno", 500);
          }
          const webhookUrl = `${appUrl.replace(/\/+$/, "")}/api/webhooks/mercadopago`;

          // ✅ idempotência com janela (evita duplicar clique, mas permite nova cobrança depois)
          const stableAmount = Number(computedPrice).toFixed(2);
          const bucket10m = Math.floor(Date.now() / (10 * 60 * 1000));
          const idempotencyKey = `${sess.tenant_id}-${client_id}-${period}-${currency}-${stableAmount}-${bucket10m}`;

          // ✅ Gerado ANTES de chamar o MP pra poder mandar como external_reference
          // (pedido da "Qualidade da integração" do MP) e usar o mesmo ID como
          // chave primária do registro interno — facilita conciliação nos dois lados.
          const internalPaymentId = randomUUID();

          const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${mpToken}`,

              "X-Idempotency-Key": idempotencyKey,
              // ✅ Item "Device ID" da Qualidade da Integração — só manda o
              // header se o front conseguiu gerar o device_id (security.js
              // pode não ter carregado a tempo), nunca bloqueia o pagamento.
              ...(mp_device_id ? { "X-meli-session-id": mp_device_id } : {}),
            },
            body: JSON.stringify({
              transaction_amount: Number(computedPrice),
              description: `${displayName} - Plano ${planLabel}`,
              payment_method_id: "pix",
              // ✅ Itens "Descrição da fatura" e "Resposta binária" da
              // Qualidade da Integração. statement_descriptor é o texto que
              // aparece na fatura do pagador (PIX não usa fatura de cartão,
              // mas o campo é aceito e pontua no score mesmo assim).
              statement_descriptor: "UNIGESTOR",
              binary_mode: true,
              payer: {
                email: `${String(client.whatsapp_username)}@unigestor.net.br`,
                first_name: String(displayName).split(" ")[0],
                last_name: String(displayName).split(" ").slice(1).join(" ") || "Cliente",
              },
              notification_url: webhookUrl,
              external_reference: internalPaymentId,
              additional_info: {
                // ✅ computedPrice já vem com o desconto do cupom subtraído
                // (antes da pendência ser somada) — então "computedPrice -
                // pendingCharges.total" aqui já dá planPriceOnly - desconto
                // sozinho, sem precisar subtrair o cupom de novo.
                items: pendingCharges.items.length
                  ? [
                      {
                        id: String(client_id),
                        title: `Plano ${planLabel}`,
                        description: `Renovação de assinatura — Plano ${planLabel}, cliente ${displayName}`,
                        quantity: 1,
                        unit_price: Number((computedPrice - pendingCharges.total).toFixed(2)),
                      },
                      ...pendingCharges.items.map((it) => ({
                        id: it.id,
                        title: it.appName ? `Pendência — ${it.appName}` : "Pendência em aberto",
                        description: it.message || "Valor pendente do cliente",
                        quantity: 1,
                        unit_price: it.convertedAmount,
                      })),
                    ]
                  : [
                      {
                        id: String(client_id),
                        title: `Plano ${planLabel}`,
                        description: `Renovação de assinatura — Plano ${planLabel}, cliente ${displayName}`,
                        quantity: 1,
                        unit_price: Number(computedPrice),
                      },
                    ],
              },
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
      id: internalPaymentId,
      tenant_id: sess.tenant_id,
      client_id,

      gateway_type: gateway.type,
      payment_method: "online",

      mp_payment_id: String(mpData.id),
      period,
      plan_label: planLabel,
      price_amount: Number(computedPrice),
      plan_price_amount: Number(planPriceOnly),
      price_currency: currency,
      status: "pending",
      settled_alert_ids: settledAlertIds,
      coupon_id: couponId,
      coupon_code: couponCodeApplied,
      coupon_discount_amount: couponDiscountAmount > 0 ? couponDiscountAmount : null,
    },
    { onConflict: "tenant_id,gateway_type,mp_payment_id" }
  )
  .select("id, mp_payment_id")
  .single();

if (insErr || !inserted) {
  safeServerLog("create-payment: upsert payment error", insErr?.message);
  Sentry.captureMessage("create-payment: upsert payment error", { level: "error", tags: { kind: "client_portal_error", route: "create-payment" }, extra: { message: insErr?.message } });
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
        // STRIPE (Cartão Internacional)
        // ======================
        if (gateway.type === "stripe") {
          const secretKey = String(gateway?.config?.secret_key || "").trim();
          const publishableKey = String(gateway?.config?.publishable_key || "").trim();

          if (!secretKey || !publishableKey) {
            safeServerLog("create-payment: stripe missing keys");
            Sentry.captureMessage("create-payment: stripe missing keys", { level: "error", tags: { kind: "client_portal_error", route: "create-payment" } });
            lastError = "Gateway misconfigured";
            continue;
          }

          const stripeParams = new URLSearchParams();
          stripeParams.append("amount", String(Math.round(Number(computedPrice) * 100)));
          stripeParams.append("currency", currency.toLowerCase());
          stripeParams.append("payment_method_types[]", "card");
          stripeParams.append("description", `${displayName} - Plano ${planLabel}`);
          stripeParams.append("metadata[client_id]", client_id);
          stripeParams.append("metadata[tenant_id]", String(sess.tenant_id));
          stripeParams.append("metadata[period]", period);
          stripeParams.append("metadata[gateway_id]", String(gateway.id));
          if (pendingCharges.total > 0) {
            stripeParams.append("metadata[pending_charges_total]", String(pendingCharges.total));
          }

          const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${secretKey}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: stripeParams,
          });

          const stripeData = await stripeRes.json().catch(() => ({} as any));

          if (stripeRes.ok && stripeData?.id && stripeData?.client_secret) {
            const { data: inserted, error: insErr } = await supabaseAdmin
              .from("client_portal_payments")
              .upsert(
                {
                  tenant_id: sess.tenant_id,
                  client_id,
                  gateway_type: gateway.type,
                  payment_method: "online",
                  mp_payment_id: String(stripeData.id),
                  period,
                  plan_label: planLabel,
                  price_amount: Number(computedPrice),
                  plan_price_amount: Number(planPriceOnly),
                  price_currency: currency,
                  status: "pending",
                  settled_alert_ids: settledAlertIds,
                  coupon_id: couponId,
                  coupon_code: couponCodeApplied,
                  coupon_discount_amount: couponDiscountAmount > 0 ? couponDiscountAmount : null,
                },
                { onConflict: "tenant_id,gateway_type,mp_payment_id" }
              )
              .select("id, mp_payment_id")
              .single();

      if (insErr || !inserted) {
        safeServerLog("create-payment: insert manual payment error", insErr?.message);
        Sentry.captureMessage("create-payment: insert manual payment error", { level: "error", tags: { kind: "client_portal_error", route: "create-payment" }, extra: { message: insErr?.message } });
        return jsonError("Erro interno", 500);
      }

return NextResponse.json(
              {
                ok: true,
                payment_method: "stripe",
                gateway_name: gateway.name,
                payment_id: String(stripeData.id),
                internal_payment_id: inserted.id,
                client_secret: stripeData.client_secret,
                publishable_key: publishableKey,
                price_amount: Number(computedPrice),
                currency,
                beneficiary_name: String(gateway?.config?.beneficiary_name || "").trim() || null,
                institution: String(gateway?.config?.institution || "").trim() || "Stripe",
              },
              { status: 200, headers: NO_STORE_HEADERS }
            );
          }

          safeServerLog("create-payment: stripe error", stripeRes.status, stripeData?.error?.message);
          lastError = "Falha ao criar pagamento no gateway";
          continue;
        }
      } catch (err: any) {
        safeServerLog(`create-payment: gateway error (${gateway?.type})`, err?.message);
        Sentry.captureException(err, { tags: { kind: "client_portal_error", route: "create-payment", gateway: gateway?.type } });
        lastError = "Falha ao criar pagamento no gateway";
        continue;
      }
    }

    // Todos os gateways falharam — tentar fallback manual dinâmico pela moeda
    const { data: manual, error: manErr } = await supabaseAdmin
      .from("payment_gateways")
      .select("*")
      .eq("tenant_id", sess.tenant_id)
      .eq("is_active", true)
      .eq("is_manual_fallback", true)
      .contains("currency", [currency])
      .limit(1)
      .maybeSingle();

if (manual && !manErr) {
      return NextResponse.json(
        {
          ok: true,
          payment_method: "manual",
          price_amount: computedPrice,
          currency,
          ...manual.config,
          gateway_type: manual.type, // ← sempre por último, nunca sobrescrito
        },
        { status: 200, headers: NO_STORE_HEADERS }
      );
    }

    // ✅ não vaza “lastError” real
    return jsonError("Erro ao criar pagamento", 500);
  } catch (err: any) {
    safeServerLog("create-payment: unexpected error", err?.message);
    Sentry.captureException(err, { tags: { kind: "client_portal_error", route: "create-payment" } });
    // ✅ não vaza detalhe nenhum
    return NextResponse.json(
      { ok: false, error: "Erro interno" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
