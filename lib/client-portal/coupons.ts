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
// apps_names, vencimento, whatsapp_username.
//
// ⚠️ Uma pessoa pode ter várias contas (client_id) vinculadas ao mesmo
// whatsapp_username — o portal já mostra todas juntas sob 1 login
// (get-accounts/route.ts) e ela escolhe qual renovar. Por isso "1 uso por
// cliente pra sempre" e "cupom pessoal restrito a um client_id" valem pra
// PESSOA (todas as contas ligadas ao mesmo whatsapp), não pra conta
// isolada — ver resolveLinkedClientIds.
//
// ⚠️ validateCouponForCharge() ainda não é chamada em nenhum lugar — a
// validação dentro de create-payment/route.ts e a UI no portal (RenewClient)
// ficam pra uma fase seguinte, quando pedido explicitamente.

import { diffDays } from "@/lib/whatsapp/template-vars";

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensal",
  BIMONTHLY: "Bimestral",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};
const LABEL_TO_PERIOD: Record<string, string> = Object.fromEntries(
  Object.entries(PERIOD_LABELS).map(([period, label]) => [label, period]),
);

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

/**
 * Um cliente pode ter várias contas (client_id diferentes) vinculadas ao
 * mesmo whatsapp_username — o portal já mostra todas juntas sob um só
 * login (app/api/client-portal/get-accounts/route.ts), e a pessoa escolhe
 * qual conta renovar. "1 uso por cliente" precisa valer pra PESSOA, não
 * pra conta isolada, senão dá pra reaplicar o mesmo cupom trocando de
 * conta. Resolve todos os client_id ligados ao mesmo whatsapp (principal
 * ou secundário) do cliente atual.
 */
async function resolveLinkedClientIds(
  supabaseAdmin: any,
  tenantId: string,
  clientRow: any,
): Promise<string[]> {
  const wa = String(clientRow?.whatsapp_username || "").trim();
  const ownId = clientRow?.id ? String(clientRow.id) : null;
  if (!wa) return ownId ? [ownId] : [];

  const { data } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("tenant_id", tenantId)
    .or(`whatsapp_username.eq.${wa},secondary_whatsapp_username.eq.${wa}`);

  const ids = ((data as { id: string }[]) || []).map((r) => r.id);
  if (ownId && !ids.includes(ownId)) ids.push(ownId);
  return ids;
}

async function hasAnyLinkedRedeemed(
  supabaseAdmin: any,
  couponId: string,
  linkedClientIds: string[],
): Promise<boolean> {
  if (!linkedClientIds.length) return false;
  const { count } = await supabaseAdmin
    .from("coupon_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("coupon_id", couponId)
    .in("client_id", linkedClientIds);
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
 * Resolve o preço PADRÃO da tabela pro plano/telas atuais do cliente
 * (mesma lógica de Regra 2 em create-payment/route.ts:227-239, sem o
 * atalho de override). Usado só pra decidir se o cliente "tem preço
 * override" — price_amount é o preço ATUAL de praticamente todo cliente
 * (não é uma flag rara), então só conta como override quando for
 * estritamente MENOR que o padrão (ex: 35 quando o padrão é 40) — nunca
 * quando só está "preenchido".
 */
async function resolveStandardPrice(
  supabaseAdmin: any,
  tenantId: string,
  clientRow: any,
): Promise<number | null> {
  try {
    const planLabel = String(clientRow?.plan_label ?? clientRow?.plan_name ?? "").trim();
    const period = LABEL_TO_PERIOD[planLabel];
    if (!period) return null;

    const screens = Number(clientRow?.screens || 1);
    const currency = getClientCurrency(clientRow);

    let planTableId = String(clientRow?.plan_table_id || "").trim();
    if (planTableId) {
      const { data: pt } = await supabaseAdmin
        .from("plan_tables")
        .select("id, currency")
        .eq("id", planTableId)
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .maybeSingle();
      if (!pt || String(pt.currency).toUpperCase() !== currency) planTableId = "";
    }
    if (!planTableId) {
      const { data: def } = await supabaseAdmin
        .from("plan_tables")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("is_system_default", true)
        .eq("currency", currency)
        .eq("is_active", true)
        .maybeSingle();
      if (!def) return null;
      planTableId = String(def.id);
    }

    const { data: item } = await supabaseAdmin
      .from("plan_table_items")
      .select("plan_table_item_prices(screens_count, price_amount)")
      .eq("plan_table_id", planTableId)
      .eq("period", period)
      .maybeSingle();

    const price = (item as any)?.plan_table_item_prices?.find(
      (p: any) => p.screens_count === screens,
    )?.price_amount;
    return price != null ? Number(price) : null;
  } catch {
    return null;
  }
}

/**
 * true só quando o cliente tem um preço PRÓPRIO menor que o padrão da
 * tabela pro plano/telas dele — nunca só por ter price_amount preenchido
 * (isso é verdade pra quase todo cliente, é o preço corrente dele, não
 * uma flag de exceção).
 */
async function isOverridePriceActive(
  supabaseAdmin: any,
  tenantId: string,
  clientRow: any,
): Promise<boolean> {
  const priceAmount = Number(clientRow?.price_amount || 0);
  if (priceAmount <= 0) return false;
  const standard = await resolveStandardPrice(supabaseAdmin, tenantId, clientRow);
  return standard != null && priceAmount < standard;
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

  const { data, error } = await supabaseAdmin
    .from("coupons")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error || !data?.length) return null;

  const rows = data as CouponRow[];
  const now = new Date();

  // Resolvidos no máximo 1x por chamada, e só se realmente precisar
  // (cupom pessoal existente, ou cupom geral a checar).
  let linkedIdsCache: string[] | null = null;
  async function linkedIds(): Promise<string[]> {
    if (!linkedIdsCache) linkedIdsCache = await resolveLinkedClientIds(supabaseAdmin, tenantId, clientRow);
    return linkedIdsCache;
  }

  let overrideChecked: boolean | null = null;
  async function isOverrideActive(): Promise<boolean> {
    if (overrideChecked == null) {
      overrideChecked = await isOverridePriceActive(supabaseAdmin, tenantId, clientRow);
    }
    return overrideChecked;
  }

  // Cupom pessoal tem prioridade sobre cupons gerais. Vale pra qualquer
  // conta vinculada ao mesmo whatsapp do cliente-alvo, não só a conta
  // exata escolhida na criação — a pessoa pode renovar por outra conta
  // dela e o cupom pessoal ainda deve valer.
  const personalCandidates = rows.filter((c) => !!c.client_id);
  let personal: CouponRow[] = [];
  if (personalCandidates.length) {
    const ids = await linkedIds();
    personal = personalCandidates.filter((c) => ids.includes(c.client_id!));
  }
  const general = rows.filter((c) => !c.client_id);

  for (const coupon of [...personal, ...general]) {
    if (coupon.starts_at && new Date(coupon.starts_at) > now) continue;
    if (coupon.ends_at && new Date(coupon.ends_at) < now) continue;

    // Cupom pessoal não usa regra de segmentação, preço override, nem a
    // regra "1 uso pra sempre" — só is_active decide (autodesativa ao ser
    // resgatado, reativado manualmente).
    if (!coupon.client_id) {
      if (await isOverrideActive()) continue;
      if (!matchesTargeting(coupon, clientRow)) continue;
      if (await hasAnyLinkedRedeemed(supabaseAdmin, coupon.id, await linkedIds())) continue;

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
 * (create-payment) sabe. ⚠️ Não é só `price_amount > 0` — isso é verdade
 * pra quase todo cliente (é o preço corrente dele). A fórmula correta,
 * igual à decisão original do Marcio, tem 3 partes: `clientOverride > 0 &&
 * PERIOD_LABELS[period] === clientPlanLabel && clientOverride <
 * precoPadraoDaTabelaPraEssePeriodo`. O create-payment já resolve o preço
 * padrão na Regra 2 pra comparar (ou reaproveite `resolveStandardPrice`
 * deste arquivo, hoje privado — exporte se precisar).
 */
export async function validateCouponForCharge(params: {
  supabaseAdmin: any;
  tenantId: string;
  clientRow: any;
  code: string;
  planPriceOnly: number;
  currency: string;
  isOverrideActive: boolean;
}): Promise<CouponValidationResult> {
  const { supabaseAdmin, tenantId, clientRow, code, planPriceOnly, currency, isOverrideActive } = params;

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

  const isPersonal = !!coupon.client_id;

  // Cupom pessoal de outra pessoa: trata como se não existisse — nunca
  // revela pra quem o código foi emitido. Vale pra qualquer conta
  // vinculada ao mesmo whatsapp, não só a conta exata escolhida na
  // criação (mesma pessoa pode renovar por outra conta dela).
  if (isPersonal) {
    const linkedIds = await resolveLinkedClientIds(supabaseAdmin, tenantId, clientRow);
    if (!linkedIds.includes(coupon.client_id)) {
      return { ok: false, reason: "Cupom inválido ou inativo." };
    }
  }

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
    const linkedIds = await resolveLinkedClientIds(supabaseAdmin, tenantId, clientRow);
    if (await hasAnyLinkedRedeemed(supabaseAdmin, coupon.id, linkedIds)) {
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
