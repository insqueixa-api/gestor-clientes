import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache", Expires: "0",
};

function makeAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function safeLog(...args: any[]) {
  if (process.env.NODE_ENV !== "production") console.error(...args);
}

function jsonError(msg: string, status: number) {
  return NextResponse.json({ ok: false, error: msg }, { status, headers: NO_STORE });
}

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensal", BIMONTHLY: "Bimestral", QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral", ANNUAL: "Anual",
};

const DAYS_BY_PERIOD: Record<string, number> = {
  MONTHLY: 30, BIMONTHLY: 60, QUARTERLY: 90, SEMIANNUAL: 180, ANNUAL: 365,
};

const CREDIT_LABELS: Record<string, number> = {
  C_10: 10, C_20: 20, C_30: 30, C_50: 50, C_100: 100,
  C_150: 150, C_200: 200, C_300: 300, C_400: 400, C_500: 500,
};

export async function POST(req: NextRequest) {
  try {
    const supabase = makeAdmin();

    // ── Auth via JWT ──────────────────────────────────────────
    const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
    if (!token) return jsonError("Não autorizado", 401);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return jsonError("Sessão inválida", 401);

    // ── Body ──────────────────────────────────────────────────
    const body = await req.json().catch(() => ({} as any));
    const payment_type: string = String(body?.payment_type || "").trim();
    const period: string       = String(body?.period || "").trim().toUpperCase();
    const force_manual         = body?.force_manual === true;

    if (!payment_type || !["renewal", "credits"].includes(payment_type)) {
      return jsonError("payment_type inválido", 400);
    }
    if (!period) return jsonError("period obrigatório", 400);

    // ── Tenant do usuário ─────────────────────────────────────
    const { data: member } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member?.tenant_id) return jsonError("Tenant não encontrado", 404);

    const myTenantId = String(member.tenant_id);

    const { data: myTenantRow } = await supabase
      .from("tenants")
      .select("name, whatsapp_sessions, saas_plan_table_id, credits_plan_table_id")
      .eq("id", myTenantId)
      .single();

    if (!myTenantRow) return jsonError("Tenant não encontrado", 404);

    const whatsappSessions = Number(myTenantRow.whatsapp_sessions || 1);

    // ── Tenant pai via saas_network ───────────────────────────
    const { data: network } = await supabase
      .from("saas_network")
      .select("parent_tenant_id")
      .eq("child_tenant_id", myTenantId)
      .maybeSingle();

    const parentTenantId = String(network?.parent_tenant_id || "");
    if (!parentTenantId) return jsonError("Sem tenant pai configurado", 400);

    // ── Tabela de preços (salva no filho, não no pai) ─────────
    const planTableId = payment_type === "renewal"
      ? String(myTenantRow.saas_plan_table_id || "")
      : String(myTenantRow.credits_plan_table_id || "");

    if (!planTableId) return jsonError("Tabela de preços não configurada", 400);

    // ── Preço ─────────────────────────────────────────────────
    const { data: planTable } = await supabase
      .from("plan_tables")
      .select("currency")
      .eq("id", planTableId)
      .single();

    const currency = String(planTable?.currency || "BRL");

    const { data: item } = await supabase
      .from("plan_table_items")
      .select("credits_base, prices:plan_table_item_prices(screens_count, price_amount)")
      .eq("plan_table_id", planTableId)
      .eq("period", period)
      .maybeSingle();

    if (!item) return jsonError("Período não encontrado na tabela de preços", 404);

    const screensCount = payment_type === "renewal" ? whatsappSessions : 1;
    const priceRow = (item as any).prices?.find((p: any) => p.screens_count === screensCount);
    const computedPrice = Number(priceRow?.price_amount || 0);

    if (!computedPrice || computedPrice <= 0) {
      return jsonError(`Preço não configurado para ${screensCount} sessão(ões)`, 400);
    }

    const days          = payment_type === "renewal" ? (DAYS_BY_PERIOD[period] || 30) : null;
    const creditsAmount = payment_type === "credits" ? (CREDIT_LABELS[period] || 0) : null;
    const periodLabel   = payment_type === "renewal"
      ? (PERIOD_LABELS[period] || period)
      : `${creditsAmount} créditos`;

    // ── Gateway do PAI ────────────────────────────────────────
    const appUrl = String(process.env.UNIGESTOR_APP_URL || process.env.APP_URL || "").replace(/\/+$/, "");
    if (!appUrl) return jsonError("Erro interno", 500);

    if (force_manual) {
      const { data: manual } = await supabase
        .from("payment_gateways")
        .select("*")
        .eq("tenant_id", parentTenantId)
        .eq("is_active", true)
        .eq("is_manual_fallback", true)
        .contains("currency", [currency])
        .limit(1)
        .maybeSingle();

      if (!manual) return jsonError("Nenhum método manual configurado", 503);
      return NextResponse.json({
        ok: true, payment_method: "manual", price_amount: computedPrice, currency,
        ...manual.config, gateway_type: manual.type,
      }, { headers: NO_STORE });
    }

    const { data: gateways } = await supabase
      .from("payment_gateways")
      .select("*")
      .eq("tenant_id", parentTenantId)
      .eq("is_active", true)
      .eq("is_online", true)
      .contains("currency", [currency])
      .order("priority", { ascending: true });

    // ── Tenta cada gateway ────────────────────────────────────
    for (const gateway of (gateways || [])) {
      try {
        // ── MERCADO PAGO ──────────────────────────────────
        if (gateway.type === "mercadopago") {
          const mpToken = String(gateway?.config?.access_token || "").trim();
          if (!mpToken) continue;

          const webhookUrl = `${appUrl}/api/webhooks/mercadopago`;
          const bucket10m  = Math.floor(Date.now() / (10 * 60 * 1000));
          const idempKey   = `saas-${myTenantId}-${parentTenantId}-${period}-${currency}-${computedPrice.toFixed(2)}-${bucket10m}`;

          const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${mpToken}`,
              "X-Idempotency-Key": idempKey,
            },
            body: JSON.stringify({
              transaction_amount: computedPrice,
              description: `${myTenantRow.name} · ${periodLabel}`,
              payment_method_id: "pix",
              payer: {
                email: `${user.email || myTenantId}`,
                first_name: String(myTenantRow.name || "Revenda").split(" ")[0],
                last_name:  String(myTenantRow.name || "").split(" ").slice(1).join(" ") || "SaaS",
              },
              notification_url: webhookUrl,
              metadata: {
                payment_source:   "saas_portal",
                buyer_tenant_id:  myTenantId,
                seller_tenant_id: parentTenantId,
                payment_type,
                period,
                gateway_id: gateway.id,
              },
              date_of_expiration: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            }),
          });

          const mpData = await mpRes.json().catch(() => ({} as any));
          if (!mpRes.ok || !mpData?.id) continue;

          const { data: inserted } = await supabase
            .from("saas_portal_payments")
            .upsert({
              tenant_id:         myTenantId,
              parent_tenant_id:  parentTenantId,
              gateway_type:      "mercadopago",
              payment_method:    "online",
              mp_payment_id:     String(mpData.id),
              payment_type,
              period,
              credits_amount:    creditsAmount,
              whatsapp_sessions: whatsappSessions,
              days,
              price_amount:      computedPrice,
              price_currency:    currency,
              status:            "pending",
            }, { onConflict: "parent_tenant_id,gateway_type,mp_payment_id" })
            .select("id")
            .single();

          if (!inserted) return jsonError("Erro interno", 500);

          return NextResponse.json({
            ok: true,
            payment_method:      "online",
            gateway_name:        gateway.name,
            payment_id:          String(mpData.id),
            internal_payment_id: inserted.id,
            pix_qr_code:         mpData.point_of_interaction?.transaction_data?.qr_code,
            pix_qr_code_base64:  mpData.point_of_interaction?.transaction_data?.qr_code_base64,
            expires_at:          new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          }, { headers: NO_STORE });
        }

        // ── STRIPE ────────────────────────────────────────
        if (gateway.type === "stripe") {
          const secretKey      = String(gateway?.config?.secret_key || "").trim();
          const publishableKey = String(gateway?.config?.publishable_key || "").trim();
          if (!secretKey || !publishableKey) continue;

          const params = new URLSearchParams();
          params.append("amount", String(Math.round(computedPrice * 100)));
          params.append("currency", currency.toLowerCase());
          params.append("payment_method_types[]", "card");
          params.append("description", `${myTenantRow.name} · ${periodLabel}`);
          params.append("metadata[payment_source]", "saas_portal");
          params.append("metadata[buyer_tenant_id]", myTenantId);
          params.append("metadata[seller_tenant_id]", parentTenantId);
          params.append("metadata[payment_type]", payment_type);
          params.append("metadata[period]", period);
          params.append("metadata[gateway_id]", String(gateway.id));

          const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
            method: "POST",
            headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: params,
          });

          const stripeData = await stripeRes.json().catch(() => ({} as any));
          if (!stripeRes.ok || !stripeData?.id) continue;

          const { data: inserted } = await supabase
            .from("saas_portal_payments")
            .upsert({
              tenant_id:         myTenantId,
              parent_tenant_id:  parentTenantId,
              gateway_type:      "stripe",
              payment_method:    "online",
              mp_payment_id:     String(stripeData.id),
              payment_type,
              period,
              credits_amount:    creditsAmount,
              whatsapp_sessions: whatsappSessions,
              days,
              price_amount:      computedPrice,
              price_currency:    currency,
              status:            "pending",
            }, { onConflict: "parent_tenant_id,gateway_type,mp_payment_id" })
            .select("id")
            .single();

          if (!inserted) return jsonError("Erro interno", 500);

          return NextResponse.json({
            ok: true,
            payment_method:      "stripe",
            gateway_name:        gateway.name,
            payment_id:          String(stripeData.id),
            internal_payment_id: inserted.id,
            client_secret:       stripeData.client_secret,
            publishable_key:     publishableKey,
            price_amount:        computedPrice,
            currency,
            beneficiary_name:    String(gateway?.config?.beneficiary_name || "").trim() || null,
            institution:         String(gateway?.config?.institution || "Stripe").trim(),
          }, { headers: NO_STORE });
        }
      } catch (e: any) {
        safeLog(`saas create-payment gateway error (${gateway?.type}):`, e?.message);
        continue;
      }
    }

    // ── Fallback manual ───────────────────────────────────────
    const { data: manual } = await supabase
      .from("payment_gateways")
      .select("*")
      .eq("tenant_id", parentTenantId)
      .eq("is_active", true)
      .eq("is_manual_fallback", true)
      .contains("currency", [currency])
      .limit(1)
      .maybeSingle();

    if (manual) {
      return NextResponse.json({
        ok: true, payment_method: "manual", price_amount: computedPrice, currency,
        ...manual.config, gateway_type: manual.type,
      }, { headers: NO_STORE });
    }

    return jsonError("Nenhum método de pagamento disponível", 503);

  } catch (e: any) {
    safeLog("saas create-payment error:", e?.message);
    return jsonError("Erro interno", 500);
  }
}