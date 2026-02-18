import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

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
    const body = await req.json().catch(() => ({} as any));

    const session_token = normalizeStr(body?.session_token);
    const client_id = normalizeStr(body?.client_id);
    const period = normalizeStr(body?.period);
    const price_amount_raw = body?.price_amount;

    // ✅ validações (sem “oráculo” e sem vazar nada)
    if (!session_token || !client_id || !period || price_amount_raw == null) {
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

    const price_amount = Number(price_amount_raw);
    if (!Number.isFinite(price_amount) || price_amount <= 0) {
      return jsonError("Valor inválido", 400);
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
      .select("id, display_name, whatsapp_username, plan_label, price_currency, screens, servers(name)")
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
    const currency = client.price_currency || "BRL";

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
          price_amount,
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
          // ✅ idempotência estável (evita duplicação por clique)
          const stableAmount = Number(price_amount).toFixed(2);
          const idempotencyKey = `${sess.tenant_id}-${client_id}-${period}-${currency}-${stableAmount}`;

          const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${gateway.config.access_token}`,
              "X-Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify({
              transaction_amount: Number(price_amount),
              description: `${displayName} - Plano ${planLabel} - ${serverName}`,
              payment_method_id: "pix",
              payer: {
                email: `${String(client.whatsapp_username)}@unigestor.net.br`,
                first_name: String(displayName).split(" ")[0],
                last_name: String(displayName).split(" ").slice(1).join(" ") || "Cliente",
              },
              notification_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/mercadopago`,
              metadata: {
                client_id,
                tenant_id: sess.tenant_id,
                period,
                price_amount: Number(price_amount),
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
              .insert({
                tenant_id: sess.tenant_id,
                client_id,

                gateway_type: gateway.type,
                payment_method: "online",

                mp_payment_id: String(mpData.id),
                period,
                plan_label: planLabel,
                price_amount: Number(price_amount),
                price_currency: currency,
                status: "pending",
              })
              .select("id, mp_payment_id")
              .single();

            if (insErr || !inserted) {
              safeServerLog("create-payment: insert payment error", insErr?.message);
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
                sourceAmount: Number(price_amount),
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
              price_amount: Number(price_amount),
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

Valor: ${new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(price_amount))}
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
          price_amount,
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
