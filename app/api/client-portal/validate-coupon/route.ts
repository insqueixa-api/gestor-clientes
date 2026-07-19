// app/api/client-portal/validate-coupon/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  validateCouponForCharge,
  couponRejectReason,
  checkCouponAbuseGuard,
  COUPON_ABUSE_BLOCKED_MESSAGE,
} from "@/lib/client-portal/coupons";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function makeSupabaseAdmin() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
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

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE_HEADERS });
}

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

// ✅ Só leitura/prévia — não cria nem altera nada, não desativa cupom
// pessoal nem grava resgate. Usado pro portal mostrar o desconto ANTES de
// clicar em "Pagar e Renovar". O create-payment recalcula tudo de novo do
// zero (mesma regra de pending-charges/route.ts), nunca confia no que
// essa rota devolveu.
export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = makeSupabaseAdmin();
    if (!supabaseAdmin) {
      return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500, headers: NO_STORE_HEADERS });
    }

    const body = await req.json().catch(() => ({} as any));
    const session_token = normalizeStr(body?.session_token);
    const client_id = normalizeStr(body?.client_id);
    const period = normalizeStr(body?.period);
    const code = normalizeStr(body?.code);

    if (!session_token || !client_id || !period || !code) return jsonError("Parâmetros incompletos", 400);
    if (!isPlausibleSessionToken(session_token)) return jsonError("Sessão inválida", 401);
    if (!isUuid(client_id)) return jsonError("Cliente não encontrado", 404);
    if (!Object.prototype.hasOwnProperty.call(PERIOD_LABELS, period)) return jsonError("Período inválido", 400);

    const { data: sess, error: sessErr } = await supabaseAdmin
      .from("client_portal_sessions")
      .select("tenant_id, whatsapp_username")
      .eq("session_token", session_token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessErr || !sess) return jsonError("Sessão inválida", 401);

    // Mesma resolução de preço de create-payment/route.ts:143-239 —
    // duplicada de propósito (mesmo padrão de pending-charges), pra não
    // mexer no arquivo de pagamento por causa de uma prévia.
    const { data: client, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("id, whatsapp_username, secondary_whatsapp_username, plan_label, price_currency, screens, plan_table_id, price_amount")
      .eq("id", client_id)
      .eq("tenant_id", sess.tenant_id)
      .or(`whatsapp_username.eq.${sess.whatsapp_username},secondary_whatsapp_username.eq.${sess.whatsapp_username}`)
      .single();

    if (clientErr || !client) return jsonError("Cliente não encontrado", 404);

    // ✅ Rate limit anti-abuso: 5 códigos diferentes tentados pela MESMA
    // CONTA (client_id, não a identidade/whatsapp) bloqueia por um tempo —
    // nem chega a validar o código de verdade (mesmo que seja válido,
    // ainda bloqueia; achado em auditoria de segurança, decisão do
    // Marcio). Só depois de confirmar que o client_id é mesmo dessa sessão
    // (senão qualquer sessão válida poderia "gastar" o limite de bloqueio
    // de uma conta alheia passando o client_id de outra pessoa). Ver
    // checkCouponAbuseGuard.
    const abuseGuard = await checkCouponAbuseGuard(supabaseAdmin, sess.tenant_id, client_id, code);
    if (abuseGuard.blocked) {
      return NextResponse.json({ ok: false, reason: COUPON_ABUSE_BLOCKED_MESSAGE }, { status: 200, headers: NO_STORE_HEADERS });
    }

    let currency = String(client.price_currency || "BRL").trim() || "BRL";
    if (currency !== "BRL") {
      // Cupons são exclusivos de contas em BRL — nem tenta resolver preço.
      return NextResponse.json({ ok: false, reason: "Cupons disponíveis apenas para contas com plano em BRL." }, { status: 200, headers: NO_STORE_HEADERS });
    }

    let planTableId = String((client as any).plan_table_id || "").trim();
    if (planTableId) {
      const { data: pt } = await supabaseAdmin
        .from("plan_tables")
        .select("id, currency")
        .eq("id", planTableId)
        .eq("tenant_id", sess.tenant_id)
        .eq("is_active", true)
        .maybeSingle();
      if (!pt) planTableId = "";
      else if (pt.currency) currency = String(pt.currency).trim() || currency;
    }
    if (!planTableId) {
      const { data: def } = await supabaseAdmin
        .from("plan_tables")
        .select("id, currency")
        .eq("tenant_id", sess.tenant_id)
        .eq("is_system_default", true)
        .eq("currency", currency)
        .eq("is_active", true)
        .maybeSingle();
      if (!def) return jsonError("Tabela de preços não encontrada", 404);
      planTableId = String(def.id);
    }

    const { data: item, error: itemErr } = await supabaseAdmin
      .from("plan_table_items")
      .select("plan_table_item_prices(screens_count, price_amount)")
      .eq("plan_table_id", planTableId)
      .eq("period", period)
      .maybeSingle();

    if (itemErr || !item) return jsonError("Plano não encontrado", 404);

    const screens = Number((client as any).screens || 1);
    const clientOverride = Number((client as any).price_amount || 0);
    const clientPlanLabel = String((client as any).plan_label || "").trim();
    const exact = (item as any).plan_table_item_prices?.find((p: any) => p.screens_count === screens);
    const standardPriceForPeriod = exact?.price_amount != null ? Number(exact.price_amount) : null;

    // Regra 1 (preço REAL cobrado, sempre): se o cliente tem um preço
    // fixado pra esse plano/período, é ele que vale — não importa se é
    // maior ou menor que o padrão da tabela. NÃO confundir com
    // isOverrideActive abaixo (achado grave: usar a mesma condição pra
    // preço e pra elegibilidade de cupom fazia clientes com preço fixado
    // ACIMA do padrão pagarem o preço PADRÃO, errado).
    const priceOverrideMatches = clientOverride > 0 && PERIOD_LABELS[period] === clientPlanLabel;

    let planPriceOnly = 0;
    if (priceOverrideMatches) {
      planPriceOnly = clientOverride;
    } else {
      if (standardPriceForPeriod == null) {
        return jsonError(`Preço não configurado para ${screens} tela(s).`, 400);
      }
      planPriceOnly = standardPriceForPeriod;
    }

    // Elegibilidade de CUPOM (nunca decide o preço cobrado): price_amount
    // está preenchido pra quase todo cliente (é o preço corrente normal
    // dele) — só bloqueia cupom quando é uma REDUÇÃO de verdade (menor
    // que o padrão), pra não empilhar desconto em cima de desconto já
    // dado. Override pra CIMA do padrão não bloqueia (mesmo bug de
    // "praticamente ninguém elegível" já corrigido em impact_preview.ts e
    // coupons.ts::findEligibleCoupon nas fases anteriores).
    const isOverrideActive =
      priceOverrideMatches && standardPriceForPeriod != null && clientOverride < standardPriceForPeriod;

    // Campos extras que validateCouponForCharge/matchesTargeting esperam
    // (status/servidor/plano/apps/vencimento/cadastro) — não vêm da
    // tabela clients, só da view.
    const { data: clientRow } = await supabaseAdmin
      .from("vw_clients_list_active")
      .select("id, computed_status, server_id, plan_name, apps_names, vencimento, created_at, price_currency, price_amount, whatsapp_username")
      .eq("tenant_id", sess.tenant_id)
      .eq("id", client_id)
      .maybeSingle();

    const result = await validateCouponForCharge({
      supabaseAdmin,
      tenantId: sess.tenant_id,
      clientRow: clientRow || client,
      code,
      planPriceOnly,
      currency,
      isOverrideActive,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, reason: couponRejectReason(result) }, { status: 200, headers: NO_STORE_HEADERS });
    }

    return NextResponse.json(
      {
        ok: true,
        code: result.coupon.code,
        discountAmount: result.discountAmount,
        discountType: result.coupon.discount_type,
        discountValue: Number(result.coupon.discount_value),
        planPriceOnly,
        currency,
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (err: any) {
    return jsonError("Erro interno", 500);
  }
}
