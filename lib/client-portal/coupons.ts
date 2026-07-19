// lib/client-portal/coupons.ts
// Cupons de desconto — fluxo de renovação do portal do cliente.
//
// O desconto incide SOMENTE sobre o valor do plano (planPriceOnly), nunca
// sobre pendências financeiras (client_alerts) — essas continuam cobradas
// 100%. Cliente com preço override no plano/período atual (mesma regra já
// usada em create-payment/route.ts: clientOverride > 0 &&
// PERIOD_LABELS[period] === clientPlanLabel) não é elegível a cupom GERAL
// (cupom pessoal ignora essa regra).
//
// ⚠️ Cupons são exclusivos de contas com plano em BRL — cliente com
// price_currency USD/EUR nunca é elegível a nenhum cupom (geral ou
// pessoal), nem recebe a tag {cupom_frase} nas mensagens automáticas.
// Decisão do Marcio: o valor total é sempre BRL, sem cálculo de câmbio.
//
// ⚠️ validateCouponForCharge() ainda não é chamada em nenhum lugar — a
// validação dentro de create-payment/route.ts e a UI no portal (RenewClient)
// ficam pra uma fase seguinte, quando pedido explicitamente.

export type CouponRow = {
  id: string;
  tenant_id: string;
  code: string;
  description: string | null;
  discount_type: "percent" | "fixed";
  discount_value: number;
  currency: string | null;
  min_account_age_days: number | null;
  starts_at: string | null;
  ends_at: string | null;
  max_total_redemptions: number | null;
  is_active: boolean;
  message_template: string | null;
  /** Se preenchido, cupom pessoal restrito a este cliente (ver findEligibleCoupon/validateCouponForCharge). */
  client_id: string | null;
};

export type CouponValidationResult =
  | { ok: true; coupon: CouponRow; discountAmount: number }
  | { ok: false; reason: string };

async function hasClientRedeemed(
  supabaseAdmin: any,
  couponId: string,
  clientId: string,
): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("coupon_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("coupon_id", couponId)
    .eq("client_id", clientId);
  return (count || 0) > 0;
}

async function countRedemptions(supabaseAdmin: any, couponId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("coupon_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("coupon_id", couponId);
  return count || 0;
}

function ageInDays(createdAt: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(createdAt).getTime()) / 86400000);
}

/**
 * Encontra o primeiro cupom elegível pra um cliente — usado pela automação
 * de cobrança (envio_agora / envio_programado) pra decidir se anuncia um
 * cupom na mensagem. Como o período de renovação ainda não foi escolhido
 * nesse ponto, a checagem de override usa o plano atual do cliente (é o que
 * ele renovaria por padrão).
 */
export async function findEligibleCoupon(params: {
  supabaseAdmin: any;
  tenantId: string;
  clientId: string;
  clientCurrency: string;
  clientCreatedAt: string | null;
  isOverrideActive: boolean;
}): Promise<CouponRow | null> {
  const { supabaseAdmin, tenantId, clientId, clientCurrency, clientCreatedAt, isOverrideActive } = params;

  // Cupons só existem pra contas em BRL — nem consulta o banco pras outras.
  if (String(clientCurrency || "").toUpperCase() !== "BRL") return null;

  const now = new Date();
  const { data, error } = await supabaseAdmin
    .from("coupons")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error || !data?.length) return null;

  const rows = data as CouponRow[];
  // Cupom pessoal (client_id) do próprio cliente tem prioridade sobre
  // cupons gerais; cupom pessoal de outro cliente nunca aparece aqui.
  // Preço override só bloqueia cupom GERAL — pessoal é uma recompensa
  // escolhida a dedo pelo Marcio (indicação), independe do plano.
  const personal = rows.filter((c) => c.client_id === clientId);
  const general = isOverrideActive ? [] : rows.filter((c) => !c.client_id);

  for (const coupon of [...personal, ...general]) {
    if (coupon.starts_at && new Date(coupon.starts_at) > now) continue;
    if (coupon.ends_at && new Date(coupon.ends_at) < now) continue;

    if (coupon.min_account_age_days != null) {
      if (!clientCreatedAt) continue;
      if (ageInDays(clientCreatedAt, now) < coupon.min_account_age_days) continue;
    }

    // Cupom pessoal não usa a regra "1 uso pra sempre" — só is_active
    // decide (autodesativa ao ser resgatado, reativado manualmente).
    if (!coupon.client_id) {
      if (await hasClientRedeemed(supabaseAdmin, coupon.id, clientId)) continue;

      if (coupon.max_total_redemptions != null) {
        const totalUses = await countRedemptions(supabaseAdmin, coupon.id);
        if (totalUses >= coupon.max_total_redemptions) continue;
      }
    }

    return coupon;
  }

  return null;
}

function formatDiscountLabel(coupon: CouponRow): string {
  if (coupon.discount_type === "percent") {
    return `${String(Number(coupon.discount_value)).replace(".", ",")}%`;
  }
  return `R$ ${Number(coupon.discount_value).toFixed(2).replace(".", ",")}`;
}

/** Gera a frase pronta pra tag {cupom_frase}. Vazia quando `coupon` é null. */
export function buildCouponPhrase(coupon: CouponRow | null): string {
  if (!coupon) return "";
  const desconto = formatDiscountLabel(coupon);
  if (coupon.message_template) {
    return coupon.message_template
      .replace(/\{codigo\}/g, coupon.code)
      .replace(/\{desconto\}/g, desconto);
  }
  return `🎁 Use o cupom *${coupon.code}* e ganhe ${desconto} de desconto na sua próxima renovação!`;
}

/**
 * Atalho usado dentro do loop de envio (envio_agora / envio_programado):
 * recebe a mesma `clientRow` (any) que já alimenta buildClientTemplateVars
 * e devolve a frase pronta (ou "" se não houver cupom elegível). Nunca
 * lança — falha de forma silenciosa pra nunca travar um envio de cobrança
 * por causa de cupom.
 */
export async function getCouponPhraseForClient(
  supabaseAdmin: any,
  tenantId: string,
  clientRow: any,
): Promise<string> {
  try {
    const clientId = clientRow?.id;
    if (!clientId) return "";

    const clientOverride = Number(clientRow?.price_amount || 0);
    const isOverrideActive = clientOverride > 0;
    const currency = String(clientRow?.price_currency || clientRow?.currency || "BRL");

    const coupon = await findEligibleCoupon({
      supabaseAdmin,
      tenantId,
      clientId,
      clientCurrency: currency,
      clientCreatedAt: clientRow?.created_at ?? null,
      isOverrideActive,
    });

    return buildCouponPhrase(coupon);
  } catch {
    return "";
  }
}

/**
 * Valida um código digitado pelo cliente no portal e calcula o desconto em
 * cima de `planPriceOnly` (nunca sobre pendências). Ainda não é chamada em
 * nenhuma rota — pronta pra quando o input de cupom for ligado no portal.
 */
export async function validateCouponForCharge(params: {
  supabaseAdmin: any;
  tenantId: string;
  clientId: string;
  code: string;
  planPriceOnly: number;
  currency: string;
  clientCreatedAt: string | null;
  isOverrideActive: boolean;
}): Promise<CouponValidationResult> {
  const {
    supabaseAdmin,
    tenantId,
    clientId,
    code,
    planPriceOnly,
    currency,
    clientCreatedAt,
    isOverrideActive,
  } = params;

  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!normalizedCode) return { ok: false, reason: "Informe um código de cupom." };

  // Cupons só existem pra contas em BRL.
  if (String(currency || "").toUpperCase() !== "BRL") {
    return { ok: false, reason: "Cupons disponíveis apenas para contas com plano em BRL." };
  }

  const { data: coupon, error } = await supabaseAdmin
    .from("coupons")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("code", normalizedCode)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !coupon) return { ok: false, reason: "Cupom inválido ou inativo." };

  // Cupom pessoal de outro cliente: trata como se não existisse — nunca
  // revela pra quem o código foi emitido.
  if (coupon.client_id && coupon.client_id !== clientId) {
    return { ok: false, reason: "Cupom inválido ou inativo." };
  }
  const isPersonal = !!coupon.client_id;

  // Preço override só bloqueia cupom GERAL — pessoal é uma recompensa
  // escolhida a dedo pelo Marcio (indicação), independe do plano.
  if (!isPersonal && isOverrideActive) {
    return {
      ok: false,
      reason: "Este plano já possui um preço especial — cupons não se aplicam.",
    };
  }

  const now = new Date();
  if (coupon.starts_at && new Date(coupon.starts_at) > now) {
    return { ok: false, reason: "Este cupom ainda não está disponível." };
  }
  if (coupon.ends_at && new Date(coupon.ends_at) < now) {
    return { ok: false, reason: "Este cupom expirou." };
  }

  if (coupon.min_account_age_days != null) {
    if (!clientCreatedAt || ageInDays(clientCreatedAt, now) < coupon.min_account_age_days) {
      return { ok: false, reason: "Cupom não disponível para esta conta." };
    }
  }

  // Cupom pessoal não usa a regra "1 uso pra sempre" — só is_active decide.
  if (!isPersonal) {
    if (await hasClientRedeemed(supabaseAdmin, coupon.id, clientId)) {
      return { ok: false, reason: "Você já utilizou este cupom." };
    }

    if (coupon.max_total_redemptions != null) {
      const totalUses = await countRedemptions(supabaseAdmin, coupon.id);
      if (totalUses >= coupon.max_total_redemptions) {
        return { ok: false, reason: "Este cupom atingiu o limite de usos." };
      }
    }
  }

  let discountAmount: number;
  if (coupon.discount_type === "percent") {
    discountAmount = Number((planPriceOnly * (Number(coupon.discount_value) / 100)).toFixed(2));
  } else {
    // Sem conversão de câmbio: cupom e cliente são sempre BRL nesse ponto.
    discountAmount = Number(coupon.discount_value);
  }

  discountAmount = Math.min(discountAmount, planPriceOnly);

  // ⚠️ Fase 2 (ainda não implementada, mora dentro do runFulfillment):
  // ao gravar o resgate em coupon_redemptions, cupom pessoal
  // (coupon.client_id preenchido) também precisa ser desativado
  // automaticamente (UPDATE coupons SET is_active = false WHERE id = ...)
  // — é assim que o Marcio "reativa manualmente" na próxima indicação.
  return { ok: true, coupon: coupon as CouponRow, discountAmount };
}
