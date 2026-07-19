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
// Regras de segmentação (target_status/target_server_ids/
// target_plan_labels/target_app_names/rule_date_field+days_min/max)
// replicam o motor de regras do Billing Automation
// (app/admin/gerenciador/cobranca/page.tsx: getImpactedClients), mas como
// uma JANELA contínua (min/max de dias) em vez de "dispara hoje se bater
// exato" — cupom é elegibilidade permanente, não um disparo único.
// `matchesTargeting` só roda pra cupom GERAL — cupom pessoal (client_id)
// ignora toda regra de segmentação, já é 1 cliente escolhido a dedo.
//
// `clientRow` esperado nas funções abaixo: uma linha de
// vw_clients_list_active/vw_clients_list_archived (via select("*")) ou
// equivalente, com pelo menos: id, price_amount, price_currency,
// created_at, computed_status, server_id, plan_label (ou plan_name),
// apps_names, vencimento.
//
// ⚠️ validateCouponForCharge() ainda não é chamada em nenhum lugar — a
// validação dentro de create-payment/route.ts e a UI no portal (RenewClient)
// ficam pra uma fase seguinte, quando pedido explicitamente.

import { diffDays } from "@/lib/whatsapp/template-vars";

export type CouponRow = {
  id: string;
  tenant_id: string;
  code: string;
  description: string | null;
  discount_type: "percent" | "fixed";
  discount_value: number;
  currency: string | null;
  starts_at: string | null;
  ends_at: string | null;
  max_total_redemptions: number | null;
  is_active: boolean;
  message_template: string | null;
  /** Se preenchido, cupom pessoal restrito a este cliente (ver findEligibleCoupon/validateCouponForCharge). */
  client_id: string | null;
  target_status: string[] | null;
  target_server_ids: string[] | null;
  target_plan_labels: string[] | null;
  target_app_names: string[] | null;
  rule_date_field: "vencimento" | "cadastro" | null;
  rule_days_min: number | null;
  rule_days_max: number | null;
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

function getClientCurrency(clientRow: any): string {
  return String(clientRow?.price_currency || clientRow?.currency || "BRL").toUpperCase();
}

/**
 * Regras de segmentação (status/servidor/plano/app/janela de dias). Só
 * roda pra cupom GERAL — chame apenas quando `coupon.client_id` for null.
 */
function matchesTargeting(coupon: CouponRow, clientRow: any): boolean {
  const status = String(clientRow?.computed_status || "").toUpperCase();
  if (coupon.target_status?.length) {
    if (!coupon.target_status.includes(status)) return false;
  } else if (status !== "ACTIVE" && status !== "OVERDUE") {
    // Sem regra explícita = ACTIVE+OVERDUE apenas. TRIAL não entra sem
    // escolha explícita (não é um fluxo de renovação).
    return false;
  }

  if (coupon.target_server_ids?.length) {
    if (!coupon.target_server_ids.includes(clientRow?.server_id)) return false;
  }

  if (coupon.target_plan_labels?.length) {
    const plan = String(clientRow?.plan_label ?? clientRow?.plan_name ?? "").trim();
    if (!coupon.target_plan_labels.includes(plan)) return false;
  }

  if (coupon.target_app_names?.length) {
    const clientApps: string[] = clientRow?.apps_names || [];
    const hasApp = clientApps.some((a) => coupon.target_app_names!.includes(a));
    if (!hasApp) return false;
  }

  if (coupon.rule_date_field) {
    const dateStr = coupon.rule_date_field === "vencimento" ? clientRow?.vencimento : clientRow?.created_at;
    if (!dateStr) return false;
    const days = diffDays(new Date(), new Date(dateStr));
    if (coupon.rule_days_min != null && days < coupon.rule_days_min) return false;
    if (coupon.rule_days_max != null && days > coupon.rule_days_max) return false;
  }

  return true;
}

/**
 * Encontra o primeiro cupom elegível pra um cliente — usado pela automação
 * de cobrança (envio_agora / envio_programado) pra decidir se anuncia um
 * cupom na mensagem, e pela prévia de impacto do admin.
 */
export async function findEligibleCoupon(params: {
  supabaseAdmin: any;
  tenantId: string;
  clientRow: any;
}): Promise<CouponRow | null> {
  const { supabaseAdmin, tenantId, clientRow } = params;

  const clientId = clientRow?.id;
  if (!clientId) return null;

  // Cupons só existem pra contas em BRL — nem consulta o banco pras outras.
  if (getClientCurrency(clientRow) !== "BRL") return null;

  const isOverrideActive = Number(clientRow?.price_amount || 0) > 0;

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

  const now = new Date();

  for (const coupon of [...personal, ...general]) {
    if (coupon.starts_at && new Date(coupon.starts_at) > now) continue;
    if (coupon.ends_at && new Date(coupon.ends_at) < now) continue;

    // Cupom pessoal não usa regra de segmentação nem a regra "1 uso pra
    // sempre" — só is_active decide (autodesativa ao ser resgatado,
    // reativado manualmente).
    if (!coupon.client_id) {
      if (!matchesTargeting(coupon, clientRow)) continue;
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
    const coupon = await findEligibleCoupon({ supabaseAdmin, tenantId, clientRow });
    return buildCouponPhrase(coupon);
  } catch {
    return "";
  }
}

/**
 * Valida um código digitado pelo cliente no portal e calcula o desconto em
 * cima de `planPriceOnly` (nunca sobre pendências). Ainda não é chamada em
 * nenhuma rota — pronta pra quando o input de cupom for ligado no portal.
 *
 * `isOverrideActive` fica como parâmetro explícito (não sai de `clientRow`)
 * porque depende do período de renovação escolhido, algo que só o chamador
 * (create-payment) sabe — mesma regra de create-payment/route.ts:224.
 */
export async function validateCouponForCharge(params: {
  supabaseAdmin: any;
  tenantId: string;
  clientId: string;
  clientRow: any;
  code: string;
  planPriceOnly: number;
  currency: string;
  isOverrideActive: boolean;
}): Promise<CouponValidationResult> {
  const { supabaseAdmin, tenantId, clientId, clientRow, code, planPriceOnly, currency, isOverrideActive } =
    params;

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

  if (!isPersonal) {
    // Preço override só bloqueia cupom GERAL — pessoal é uma recompensa
    // escolhida a dedo pelo Marcio (indicação), independe do plano.
    if (isOverrideActive) {
      return {
        ok: false,
        reason: "Este plano já possui um preço especial — cupons não se aplicam.",
      };
    }
    if (!matchesTargeting(coupon as CouponRow, clientRow)) {
      return { ok: false, reason: "Cupom não disponível para esta conta." };
    }
  }

  const now = new Date();
  if (coupon.starts_at && new Date(coupon.starts_at) > now) {
    return { ok: false, reason: "Este cupom ainda não está disponível." };
  }
  if (coupon.ends_at && new Date(coupon.ends_at) < now) {
    return { ok: false, reason: "Este cupom expirou." };
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
