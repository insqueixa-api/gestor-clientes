// app/api/client-portal/pay-pending/route.ts
//
// ✅ 02/10/2026, pedido do Márcio (docs/alertas-confianca/PLANO.md, etapa 3):
// botão "Pagar só a pendência" no portal — o cliente quita os sinos em aberto
// (renovação em confiança, ativação de app) SEM renovar a assinatura e SEM
// gastar crédito. Rota separada de propósito: create-payment (mensalidade)
// fica intocada.
//
// Grava client_portal_payments com payment_type='pending_charge'. Quando o
// gateway aprova, os 5 caminhos de aprovação (webhooks MP/Stripe/FastDePix,
// payment-status, retry-fulfillment) chamam runFulfillment, que desvia
// esse tipo logo no início pra settle_portal_payment_alerts (banco) — nunca
// chega na parte que renova.
//
// Valor: sempre recalculado aqui a partir dos sinos OPEN (getPendingCharges),
// nunca vindo do front. Só gateways ONLINE — transferência manual continua
// pelo 👍 do sino no admin.
import { NextRequest, NextResponse } from "next/server";
import { randomUUID, createHash } from "crypto";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";
import { getPendingCharges, type PendingChargeItem } from "@/lib/client-portal/pending-charges";
import { sanitizeEmailLocalPart } from "@/lib/whatsapp/template-vars";
import { createFastDepixTransaction, getFastDepixTransaction, fetchQrCodeAsBase64, isFastDepixGatewayType } from "@/lib/fastdepix";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function normalizeStr(v: unknown) {
  return String(v ?? "").trim();
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

function getAppOrigin() {
  const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").trim();
  return appUrl.replace(/\/+$/, "");
}

// Texto de cada pendência no extrato do gateway e no resumo do portal
function pendingItemLabel(it: Pick<PendingChargeItem, "kind" | "meta" | "appName" | "message">) {
  if (it.kind === "renewal_trust") {
    const plan = String(it.meta?.plan_label || "").trim();
    return plan ? `Renovação em confiança — ${plan}` : "Renovação em confiança";
  }
  const app = it.appName || String(it.meta?.app_name || "").trim() || it.message.match(/"(.+?)"/)?.[1] || "";
  if (it.kind === "app_activation" || app) return app ? `Ativação de aplicativo — ${app}` : "Ativação de aplicativo";
  return "Pendência em aberto";
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) return jsonError("Erro interno", 500);

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    const client_id = normalizeStr(body?.client_id);
    const exclude_gateway_type = normalizeStr(body?.exclude_gateway_type);
    const mp_device_id = normalizeStr(body?.mp_device_id);

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("display_name, secondary_display_name, whatsapp_username, secondary_whatsapp_username, server_username, price_currency")
      .eq("id", client_id)
      .eq("tenant_id", ctx.tenant_id)
      .single();
    if (!client) return jsonError("Cliente não encontrado", 404);

    const isSecondary = client.secondary_whatsapp_username === ctx.whatsapp_username;
    const displayName = isSecondary ? client.secondary_display_name || "Cliente" : client.display_name || "Cliente";
    const serverUsernameTag = String(client.server_username || "").trim();
    const payerLabel = serverUsernameTag ? `${displayName} (${serverUsernameTag})` : displayName;
    const withUsername = (text: string) => (serverUsernameTag ? `${text} — ${serverUsernameTag}` : text);
    const currency = String(client.price_currency || "BRL").trim() || "BRL";

    // ✅ Valor sempre do banco (sinos OPEN), na moeda da conta
    const pending = await getPendingCharges(supabaseAdmin, ctx.tenant_id, client_id, currency);
    if (!pending.items.length) return jsonError("Você não tem pendência em aberto.", 400);
    const total = Number(pending.total.toFixed(2));
    if (!(total > 0)) return jsonError("Você não tem pendência em aberto.", 400);
    // parte "renovação em confiança" — o resto conta como Aplicativos nos painéis
    const trustPart = Number(
      pending.items.filter((i) => i.kind === "renewal_trust").reduce((s, i) => s + i.convertedAmount, 0).toFixed(2),
    );
    const alertIds = [...pending.alertIds].sort();
    const alertKey = alertIds.join(",");
    const alertHash = createHash("sha1").update(alertKey).digest("hex").slice(0, 10);
    const itemsForResponse = pending.items.map((i) => ({
      label: pendingItemLabel(i),
      amount: i.convertedAmount,
      activation_date: i.activationDate,
    }));
    const description = withUsername(
      pending.items.length === 1 ? pendingItemLabel(pending.items[0]) : `Pendências (${pending.items.length})`,
    );

    // ✅ Anti-duplicação 1: já tem pagamento de pendência aprovado ainda
    // sendo processado → nunca gera outro.
    const { data: processing } = await supabaseAdmin
      .from("client_portal_payments")
      .select("id")
      .eq("tenant_id", ctx.tenant_id)
      .eq("client_id", client_id)
      .eq("payment_type", "pending_charge")
      .eq("status", "approved")
      // null = webhook ainda nem marcou "pending" — também conta como em andamento
      .or("fulfillment_status.is.null,fulfillment_status.not.in.(done,manual_done)")
      .limit(1)
      .maybeSingle();
    if (processing) {
      return jsonError("Seu pagamento da pendência já foi recebido e está sendo processado.", 409);
    }

    const { data: gateways, error: gwErr } = await supabaseAdmin
      .from("payment_gateways")
      .select("*")
      .eq("tenant_id", ctx.tenant_id)
      .eq("is_active", true)
      .eq("is_online", true)
      .contains("currency", [currency])
      .order("priority", { ascending: true });
    if (gwErr || !gateways?.length) {
      return jsonError("Pagamento online indisponível agora. Fale com o suporte pra pagar a pendência.", 503);
    }
    const usable = (g: any) =>
      g.type === "mercadopago" || g.type === "stripe" || (isFastDepixGatewayType(g.type) && g.type !== "depix");
    const gateway = gateways.find((g: any) => usable(g) && (!exclude_gateway_type || g.type !== exclude_gateway_type));
    if (!gateway) return jsonError("Não há outro método de pagamento disponível pra tentar.", 503);
    const hasAlternate = gateways.filter(usable).length > 1;

    const baseRow = {
      tenant_id: ctx.tenant_id,
      client_id,
      gateway_type: gateway.type,
      payment_method: "online",
      payment_type: "pending_charge",
      plan_label: "Pendência",
      price_amount: total,
      plan_price_amount: trustPart,
      price_currency: currency,
      status: "pending",
      settled_alert_ids: alertIds,
      payer_whatsapp_username: ctx.whatsapp_username,
    };
    const baseResponse = {
      ok: true,
      gateway_name: gateway.name,
      gateway_type: gateway.type,
      has_alternate_gateway: hasAlternate,
      price_amount: total,
      currency,
      items: itemsForResponse,
    };

    // ✅ Anti-duplicação 2: PIX de pendência ainda em aberto → mesmo
    // conjunto de sinos e mesmo valor devolve o MESMO código; senão o
    // antigo é cancelado (MP) antes de gerar outro.
    const { data: existing } = await supabaseAdmin
      .from("client_portal_payments")
      .select("id, mp_payment_id, gateway_type, price_amount, settled_alert_ids")
      .eq("tenant_id", ctx.tenant_id)
      .eq("client_id", client_id)
      .eq("payment_type", "pending_charge")
      .eq("status", "pending")
      .gte("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sameSelection =
      !!existing &&
      existing.gateway_type === gateway.type &&
      Math.abs(Number(existing.price_amount || 0) - total) < 0.01 &&
      [...((existing.settled_alert_ids as string[] | null) || [])].sort().join(",") === alertKey;

    // ======================
    // STRIPE (cliente USD/EUR)
    // ======================
    if (gateway.type === "stripe") {
      const secretKey = String(gateway?.config?.secret_key || "").trim();
      const publishableKey = String(gateway?.config?.publishable_key || "").trim();
      if (!secretKey || !publishableKey) return jsonError("Erro interno", 500);

      const stripeParams = new URLSearchParams();
      stripeParams.append("amount", String(Math.round(total * 100)));
      stripeParams.append("currency", currency.toLowerCase());
      stripeParams.append("payment_method_types[]", "card");
      stripeParams.append("description", description);
      stripeParams.append("metadata[client_id]", client_id);
      stripeParams.append("metadata[tenant_id]", String(ctx.tenant_id));
      stripeParams.append("metadata[payment_type]", "pending_charge");
      stripeParams.append("metadata[gateway_id]", String(gateway.id));

      // mesmo pedido em 10min = mesmo PaymentIntent (duplo clique/retry)
      const bucket10m = Math.floor(Date.now() / (10 * 60 * 1000));
      const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": `paypending-${ctx.tenant_id}-${client_id}-${alertHash}-${total.toFixed(2)}-${bucket10m}`,
        },
        body: stripeParams,
      });
      const stripeData = await stripeRes.json().catch(() => ({} as any));
      if (!stripeRes.ok || !stripeData?.id || !stripeData?.client_secret) {
        console.error("[pay-pending] stripe error", stripeRes.status, stripeData?.error?.message);
        return jsonError("Falha ao criar pagamento no gateway", 502);
      }

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("client_portal_payments")
        .upsert({ ...baseRow, mp_payment_id: String(stripeData.id) }, { onConflict: "tenant_id,gateway_type,mp_payment_id" })
        .select("id")
        .single();
      if (insErr || !inserted) {
        console.error("[pay-pending] upsert error", insErr?.message);
        return jsonError("Erro interno", 500);
      }

      return NextResponse.json(
        {
          ...baseResponse,
          payment_method: "stripe",
          payment_id: String(stripeData.id),
          internal_payment_id: inserted.id,
          client_secret: stripeData.client_secret,
          publishable_key: publishableKey,
        },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    // ======================
    // FASTDEPIX (FastPay / FastFlow)
    // ======================
    if (isFastDepixGatewayType(gateway.type)) {
      const apiKey = String(gateway?.config?.api_key || "").trim();
      if (!apiKey) return jsonError("Erro interno", 500);

      if (sameSelection && existing?.mp_payment_id) {
        try {
          const tx = await getFastDepixTransaction(apiKey, existing.mp_payment_id);
          if (String(tx.status || "").toLowerCase() === "pending") {
            const qrBase64 = tx.qr_code ? await fetchQrCodeAsBase64(tx.qr_code) : null;
            return NextResponse.json(
              {
                ...baseResponse,
                payment_method: "online",
                payment_id: String(tx.id),
                internal_payment_id: existing.id,
                pix_qr_code: tx.qr_code_text || undefined,
                pix_qr_code_base64: qrBase64 || undefined,
                expires_at: tx.qr_code_expires_at || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
              },
              { status: 200, headers: NO_STORE_HEADERS },
            );
          }
        } catch (e: any) {
          console.error("[pay-pending] fastdepix reuse check failed", e?.message);
        }
      }

      const appUrl = getAppOrigin();
      try {
        const tx = await createFastDepixTransaction({
          apiKey,
          providerType: gateway.type,
          amount: total,
          payerName: payerLabel,
          notificationUrl: appUrl ? `${appUrl}/api/webhooks/fastdepix` : undefined,
        });
        const qrBase64 = tx.qr_code ? await fetchQrCodeAsBase64(tx.qr_code) : null;
        const { data: inserted, error: insErr } = await supabaseAdmin
          .from("client_portal_payments")
          .upsert({ ...baseRow, mp_payment_id: String(tx.id) }, { onConflict: "tenant_id,gateway_type,mp_payment_id" })
          .select("id")
          .single();
        if (insErr || !inserted) {
          console.error("[pay-pending] upsert error", insErr?.message);
          return jsonError("Erro interno", 500);
        }
        return NextResponse.json(
          {
            ...baseResponse,
            payment_method: "online",
            payment_id: String(tx.id),
            internal_payment_id: inserted.id,
            pix_qr_code: tx.qr_code_text || undefined,
            pix_qr_code_base64: qrBase64 || undefined,
            expires_at: tx.qr_code_expires_at || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          },
          { status: 200, headers: NO_STORE_HEADERS },
        );
      } catch (fdErr: any) {
        console.error(`[pay-pending] ${gateway.type} error`, fdErr?.message);
        return jsonError("Falha ao criar pagamento no gateway", 502);
      }
    }

    // ======================
    // MERCADO PAGO (PIX)
    // ======================
    const mpToken = String(gateway?.config?.access_token || "").trim();
    if (!mpToken) return jsonError("Erro interno", 500);

    if (existing?.mp_payment_id && existing.gateway_type === "mercadopago") {
      try {
        const getRes = await fetch(`https://api.mercadopago.com/v1/payments/${existing.mp_payment_id}`, {
          headers: { Authorization: `Bearer ${mpToken}` },
        });
        const getData = await getRes.json().catch(() => ({} as any));
        if (getRes.ok && (getData?.status === "approved" || getData?.status === "in_process")) {
          return jsonError("Esse pagamento já está sendo processado. Aguarde a confirmação.", 409);
        }
        if (getRes.ok && getData?.status === "pending") {
          if (sameSelection) {
            return NextResponse.json(
              {
                ...baseResponse,
                payment_method: "online",
                payment_id: String(existing.mp_payment_id),
                internal_payment_id: existing.id,
                pix_qr_code: getData.point_of_interaction?.transaction_data?.qr_code,
                pix_qr_code_base64: getData.point_of_interaction?.transaction_data?.qr_code_base64,
                expires_at: getData.date_of_expiration,
              },
              { status: 200, headers: NO_STORE_HEADERS },
            );
          }
          // outra seleção (sino novo/fechado no meio) → cancela o antigo
          const cancelRes = await fetch(`https://api.mercadopago.com/v1/payments/${existing.mp_payment_id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${mpToken}` },
            body: JSON.stringify({ status: "cancelled" }),
          });
          if (cancelRes.ok) {
            await supabaseAdmin
              .from("client_portal_payments")
              .update({ status: "cancelled" })
              .eq("id", existing.id)
              .eq("status", "pending");
          }
        }
      } catch (e: any) {
        console.error("[pay-pending] failed to check existing MP payment", e?.message);
      }
    }

    const appUrl = getAppOrigin();
    if (!appUrl) return jsonError("Erro interno", 500);
    const internalPaymentId = randomUUID();
    const bucket10m = Math.floor(Date.now() / (10 * 60 * 1000));

    const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpToken}`,
        "X-Idempotency-Key": `paypending-${ctx.tenant_id}-${client_id}-${alertHash}-${total.toFixed(2)}-${bucket10m}`,
        ...(mp_device_id ? { "X-meli-session-id": mp_device_id } : {}),
      },
      body: JSON.stringify({
        transaction_amount: total,
        description,
        payment_method_id: "pix",
        statement_descriptor: "UNIGESTOR",
        binary_mode: true,
        payer: {
          email: `${sanitizeEmailLocalPart(ctx.whatsapp_username)}@unigestor.net.br`,
          first_name: String(displayName).split(" ")[0],
          last_name: String(displayName).split(" ").slice(1).join(" ") || "Cliente",
        },
        notification_url: `${appUrl}/api/webhooks/mercadopago`,
        external_reference: internalPaymentId,
        additional_info: {
          items: pending.items.map((it) => ({
            id: it.id,
            title: withUsername(pendingItemLabel(it)),
            description: `Pendência — cliente ${payerLabel}`,
            quantity: 1,
            unit_price: it.convertedAmount,
          })),
        },
        metadata: {
          client_id,
          tenant_id: ctx.tenant_id,
          payment_type: "pending_charge",
          gateway_id: gateway.id,
          server_username: serverUsernameTag || null,
          payer_name: displayName,
        },
        date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }),
    });
    const mpData = await mpResponse.json().catch(() => ({} as any));
    if (!mpResponse.ok || !mpData?.id) {
      console.error("[pay-pending] gateway error", { status: mpResponse.status });
      return jsonError("Falha ao criar pagamento no gateway", 502);
    }

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("client_portal_payments")
      .upsert(
        { ...baseRow, id: internalPaymentId, mp_payment_id: String(mpData.id) },
        { onConflict: "tenant_id,gateway_type,mp_payment_id" },
      )
      .select("id")
      .single();
    if (insErr || !inserted) {
      console.error("[pay-pending] upsert error", insErr?.message);
      return jsonError("Erro interno", 500);
    }

    return NextResponse.json(
      {
        ...baseResponse,
        payment_method: "online",
        payment_id: String(mpData.id),
        internal_payment_id: inserted.id,
        pix_qr_code: mpData.point_of_interaction?.transaction_data?.qr_code,
        pix_qr_code_base64: mpData.point_of_interaction?.transaction_data?.qr_code_base64,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (err: any) {
    console.error("[pay-pending] unexpected", err?.message);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
