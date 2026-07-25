// app/api/client-portal/apps/renew-payment/route.ts
//
// Botão "Renovar aplicativo" da página de detalhe (/renew-beta/apps/[id]) —
// pedido do Marcio (25/07/2026): pagamento avulso da LICENÇA do app (ex:
// DupleCast R$30/ano), separado da assinatura IPTV do cliente. Reaproveita
// a mesma tabela client_portal_payments e o mesmo webhook do MP/Stripe já
// validados — só marca payment_type='app_renewal' pra eles NUNCA rodarem
// o fulfillment de assinatura (nunca mexe em clients.vencimento).
//
// Preço vem de apps.license_price (BRL sempre — mesmo padrão de cupons e
// preços do bot, sem conversão de moeda). Nunca confia em preço vindo do
// front — sempre lê de novo do catálogo aqui.
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { makeSupabaseAdmin, validatePortalClient } from "@/lib/client-portal/session";

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

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) return jsonError("Erro interno", 500);

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    const client_id = normalizeStr(body?.client_id);
    const client_app_id = normalizeStr(body?.client_app_id);

    const ctx = await validatePortalClient(supabaseAdmin, session_token, client_id);
    if (!ctx) return jsonError("Sessão inválida ou cliente não encontrado", 401);
    if (!client_app_id) return jsonError("client_app_id é obrigatório", 400);

    const { data: row, error: rowErr } = await supabaseAdmin
      .from("client_apps")
      .select("id, apps(name, cost_type, license_price, license_period)")
      .eq("id", client_app_id)
      .eq("client_id", client_id)
      .single();
    if (rowErr || !row) return jsonError("Aplicativo não encontrado", 404);

    const appName = (row as any).apps?.name || "Aplicativo";
    const costType = (row as any).apps?.cost_type;
    const licensePrice = Number((row as any).apps?.license_price || 0);

    if (costType !== "paid" || !(licensePrice > 0)) {
      return jsonError("Esse aplicativo não tem cobrança de licença configurada.", 400);
    }

    const { data: client } = await supabaseAdmin
      .from("clients")
      .select("display_name, secondary_display_name, whatsapp_username, secondary_whatsapp_username")
      .eq("id", client_id)
      .single();
    const isSecondary = client?.secondary_whatsapp_username === ctx.whatsapp_username;
    const displayName = isSecondary ? (client?.secondary_display_name || "Cliente") : (client?.display_name || "Cliente");

    // Licenças de app são sempre cobradas em BRL (mesmo padrão de cupons —
    // sem conversão de câmbio numa área onde o valor já é "estimado").
    const currency = "BRL";

    const { data: gateways, error: gwErr } = await supabaseAdmin
      .from("payment_gateways")
      .select("*")
      .eq("tenant_id", ctx.tenant_id)
      .eq("is_active", true)
      .eq("is_online", true)
      .eq("type", "mercadopago")
      .contains("currency", [currency])
      .order("priority", { ascending: true })
      .limit(1);

    if (gwErr || !gateways?.length) {
      return jsonError("Nenhum método de pagamento disponível pra licença de app no momento.", 503);
    }

    const gateway = gateways[0];
    const mpToken = String(gateway?.config?.access_token || "").trim();
    if (!mpToken) return jsonError("Erro interno", 500);

    const appUrl = getAppOrigin();
    if (!appUrl) return jsonError("Erro interno", 500);
    const webhookUrl = `${appUrl}/api/webhooks/mercadopago`;

    const stableAmount = licensePrice.toFixed(2);
    const bucket10m = Math.floor(Date.now() / (10 * 60 * 1000));
    const idempotencyKey = `apprenew-${ctx.tenant_id}-${client_app_id}-${stableAmount}-${bucket10m}`;
    const internalPaymentId = randomUUID();

    const mpResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpToken}`,
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: licensePrice,
        description: `Renovação de licença — ${appName}`,
        payment_method_id: "pix",
        statement_descriptor: "UNIGESTOR",
        binary_mode: true,
        payer: {
          email: `${String(ctx.whatsapp_username)}@unigestor.net.br`,
          first_name: String(displayName).split(" ")[0],
          last_name: String(displayName).split(" ").slice(1).join(" ") || "Cliente",
        },
        notification_url: webhookUrl,
        external_reference: internalPaymentId,
        additional_info: {
          items: [
            {
              id: client_app_id,
              title: `Licença — ${appName}`,
              description: `Renovação de licença do aplicativo ${appName}, cliente ${displayName}`,
              quantity: 1,
              unit_price: licensePrice,
            },
          ],
        },
        metadata: {
          client_id,
          tenant_id: ctx.tenant_id,
          client_app_id,
          payment_type: "app_renewal",
          gateway_id: gateway.id,
        },
        date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }),
    });

    const mpData = await mpResponse.json().catch(() => ({} as any));

    if (!mpResponse.ok || !mpData?.id) {
      console.error("[apps/renew-payment] gateway error", { status: mpResponse.status });
      return jsonError("Falha ao criar pagamento no gateway", 502);
    }

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("client_portal_payments")
      .upsert(
        {
          id: internalPaymentId,
          tenant_id: ctx.tenant_id,
          client_id,
          gateway_type: gateway.type,
          payment_method: "online",
          mp_payment_id: String(mpData.id),
          price_amount: licensePrice,
          price_currency: currency,
          status: "pending",
          payment_type: "app_renewal",
          client_app_id,
          app_name_snapshot: appName,
        },
        { onConflict: "tenant_id,gateway_type,mp_payment_id" },
      )
      .select("id, mp_payment_id")
      .single();

    if (insErr || !inserted) {
      console.error("[apps/renew-payment] upsert error", insErr?.message);
      return jsonError("Erro interno", 500);
    }

    return NextResponse.json(
      {
        ok: true,
        payment_id: String(mpData.id),
        internal_payment_id: inserted.id,
        price_amount: licensePrice,
        currency,
        pix_qr_code: mpData.point_of_interaction?.transaction_data?.qr_code,
        pix_qr_code_base64: mpData.point_of_interaction?.transaction_data?.qr_code_base64,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (err: any) {
    console.error("[apps/renew-payment] unexpected", err?.message);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
