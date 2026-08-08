// app/admin/settings/cupons/impact_preview.ts
// Prévia de impacto de um cupom: quantos clientes seriam elegíveis hoje e
// qual seria o valor total de renovação normal vs. com o cupom aplicado,
// se todos renovassem agora nas condições atuais. Roda 100% no browser via
// supabaseBrowser — mesmo padrão já usado em
// app/admin/gerenciador/cobranca/page.tsx (cálculo client-side sobre os
// clientes carregados).
//
// Fonte de dados: vw_clients_list_active, a mesma view que a Régua de
// Cobrança usa — já traz computed_status (ACTIVE/OVERDUE/TRIAL), server_id,
// plan_name, apps_names, vencimento, tudo num só lugar (evita o bug de
// `clients_1.username does not exist` da tabela crua, que não tem esses
// alias/campos calculados).
//
// Regras de segmentação replicam getImpactedClients de
// app/admin/gerenciador/cobranca/page.tsx:875 (status/servidor/plano/app),
// mas como uma JANELA de dias (min/max) em vez de "dispara hoje se bater
// exato" — cupom é elegibilidade permanente, não um disparo único.
//
// Cupons são exclusivos de contas com plano em BRL (decisão do Marcio) —
// só entram no cálculo clientes com price_currency = BRL, e o total é
// sempre uma estimativa em BRL, sem câmbio.
//
// A resolução de plan_table_id → preço replica exatamente a lógica de
// app/api/client-portal/create-payment/route.ts (linhas ~143-239), mas em
// lote (1 query por tabela de preço distinta, não 1 por cliente) — esse
// arquivo é só lido, nunca importado aqui, pra não criar acoplamento com um
// arquivo que não deve ser tocado nesta fase.

import { supabaseBrowser } from "@/lib/supabase/browser";
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

export type CouponRulesParams = {
  targetStatus: string[] | null;
  targetServerIds: string[] | null;
  targetPlanLabels: string[] | null;
  targetAppNames: string[] | null;
  ruleDateField: "vencimento" | "cadastro" | null;
  ruleDaysMin: number | null;
  ruleDaysMax: number | null;
};

/** Preço normal x com desconto de uma conta específica — usado no cupom pessoal. */
export type ImpactClientRow = {
  id: string;
  name: string;
  username: string;
  normalPrice: number;
  discountedPrice: number;
};

/** Uma conta dentro do grupo de uma pessoa — elegíveis têm preço, as demais não. */
export type ImpactAccountRow = {
  id: string;
  username: string;
  serverName: string;
  eligible: boolean;
  normalPrice: number | null;
  discountedPrice: number | null;
};

/**
 * Uma pessoa pode ter várias contas (client_id) vinculadas ao mesmo
 * whatsapp — o portal mostra todas juntas sob 1 login e ela escolhe qual
 * renovar (get-accounts/route.ts). Um grupo = 1 pessoa, com TODAS as
 * contas dela que aparecem na tabela de clientes (elegíveis ou não),
 * pra dar contexto completo — "Insqueixa" sozinho não diz em qual
 * servidor, por exemplo.
 */
export type ImpactPersonGroup = {
  key: string;
  name: string;
  accounts: ImpactAccountRow[];
};

export type ImpactResult = {
  totalClients: number;
  totalNormal: number;
  totalDiscounted: number;
  groups: ImpactPersonGroup[];
};

type PlanTableLite = { id: string; currency: string; is_system_default: boolean };

export type ClientLite = {
  id: string;
  client_name: string | null;
  username: string | null;
  server_name: string | null;
  computed_status: string | null;
  server_id: string | null;
  plan_name: string | null;
  apps_names: string[] | null;
  vencimento: string | null;
  screens: number | null;
  price_currency: string | null;
  price_amount: number | null;
  plan_table_id: string | null;
  created_at: string | null;
  whatsapp_username: string | null;
};

export const CLIENT_SELECT =
  "id, client_name, username, server_name, computed_status, server_id, plan_name, apps_names, vencimento, screens, price_currency, price_amount, plan_table_id, created_at, whatsapp_username";

/** Resolve a tabela de preço BRL do cliente. Retorna null se não achar uma tabela BRL. */
function resolveBRLPlanTable(planTables: PlanTableLite[], client: ClientLite): string | null {
  if (client.plan_table_id) {
    const pt = planTables.find((t) => t.id === client.plan_table_id);
    if (pt && pt.currency === "BRL") return pt.id;
  }
  const def = planTables.find((t) => t.is_system_default && t.currency === "BRL");
  return def ? def.id : null;
}

function computeDiscountedPrice(
  normalPrice: number,
  discountType: "percent" | "fixed",
  discountValue: number,
): number {
  const discount =
    discountType === "percent"
      ? Number((normalPrice * (discountValue / 100)).toFixed(2))
      : discountValue;
  return Math.max(0, Number((normalPrice - discount).toFixed(2)));
}

/** Mesma lógica de matchesTargeting em lib/client-portal/coupons.ts, adaptada pro shape da view. */
export function matchesRules(rules: CouponRulesParams, client: ClientLite, now: Date): boolean {
  const status = String(client.computed_status || "").toUpperCase();
  if (rules.targetStatus?.length) {
    if (!rules.targetStatus.includes(status)) return false;
  } else if (status !== "ACTIVE" && status !== "OVERDUE") {
    return false;
  }

  if (rules.targetServerIds?.length) {
    if (!client.server_id || !rules.targetServerIds.includes(client.server_id)) return false;
  }

  if (rules.targetPlanLabels?.length) {
    const plan = String(client.plan_name || "").trim();
    if (!rules.targetPlanLabels.includes(plan)) return false;
  }

  if (rules.targetAppNames?.length) {
    const clientApps = client.apps_names || [];
    const hasApp = clientApps.some((a) => rules.targetAppNames!.includes(a));
    if (!hasApp) return false;
  }

  if (rules.ruleDateField) {
    const dateStr = rules.ruleDateField === "vencimento" ? client.vencimento : client.created_at;
    if (!dateStr) return false;
    const days = diffDays(now, new Date(dateStr));
    if (rules.ruleDaysMin != null && days < rules.ruleDaysMin) return false;
    if (rules.ruleDaysMax != null && days > rules.ruleDaysMax) return false;
  }

  return true;
}

export async function computeCouponImpact(
  params: {
    tenantId: string;
    discountType: "percent" | "fixed";
    discountValue: number;
    excludeCouponId?: string;
  } & CouponRulesParams,
): Promise<ImpactResult> {
  const { tenantId, discountType, discountValue, excludeCouponId, ...rules } = params;

  const [{ data: clientsData }, { data: planTablesData }] = await Promise.all([
    supabaseBrowser
      .from("vw_clients_list_active")
      .select(CLIENT_SELECT)
      .eq("tenant_id", tenantId)
      .eq("price_currency", "BRL"),
    supabaseBrowser
      .from("plan_tables")
      .select("id, currency, is_system_default")
      .eq("tenant_id", tenantId)
      .eq("is_active", true),
  ]);

  const allClients = (clientsData as ClientLite[]) || [];
  const planTables = (planTablesData as PlanTableLite[]) || [];

  const now = new Date();

  // "Já usou" é por CONTA (client_id = username do servidor), não pela
  // pessoa/whatsapp inteira — cada conta é uma assinatura paga separada,
  // então cada uma pode usar o cupom geral uma vez (mesma regra de
  // lib/client-portal/coupons.ts::hasClientRedeemed — não expande mais
  // pras contas-irmãs vinculadas ao mesmo whatsapp).
  let excludedClientIds: Set<string> | null = null;
  if (excludeCouponId) {
    const { data: redemptions } = await supabaseBrowser
      .from("coupon_redemptions")
      .select("client_id")
      .eq("coupon_id", excludeCouponId);
    const redeemedIds = ((redemptions as { client_id: string }[]) || []).map((r) => r.client_id);
    excludedClientIds = new Set(redeemedIds);
  }

  const eligible = allClients.filter((c) => {
    if (excludedClientIds?.has(c.id)) return false; // já resgatou este cupom
    return matchesRules(rules, c, now);
  });

  // Uma query por tabela de preço distinta, não uma por cliente.
  const planTableIds = Array.from(
    new Set(
      eligible.map((c) => resolveBRLPlanTable(planTables, c)).filter((id): id is string => !!id),
    ),
  );

  const priceMap = new Map<string, number>(); // `${planTableId}|${period}|${screens}` -> price

  if (planTableIds.length) {
    const { data: itemsData } = await supabaseBrowser
      .from("plan_table_items")
      .select("plan_table_id, period, plan_table_item_prices(screens_count, price_amount)")
      .in("plan_table_id", planTableIds);

    for (const item of (itemsData as any[]) || []) {
      for (const price of item.plan_table_item_prices || []) {
        priceMap.set(
          `${item.plan_table_id}|${item.period}|${price.screens_count}`,
          Number(price.price_amount),
        );
      }
    }
  }

  type EligibleAccount = { client: ClientLite; normalPrice: number; discountedPrice: number };
  const eligibleAccounts: EligibleAccount[] = [];
  for (const client of eligible) {
    const planTableId = resolveBRLPlanTable(planTables, client);
    if (!planTableId) continue;

    const period = LABEL_TO_PERIOD[String(client.plan_name || "").trim()];
    if (!period) continue;

    const screens = Number(client.screens || 1);
    const standardPrice = priceMap.get(`${planTableId}|${period}|${screens}`);
    if (standardPrice == null) continue;

    // Preço override: só exclui quando o preço PRÓPRIO do cliente é
    // menor que o padrão da tabela (ex: 35 quando o padrão é 40) — não
    // basta ter price_amount preenchido, isso é verdade pra quase todo
    // cliente (é o preço corrente dele, não uma flag de exceção rara).
    const priceAmount = Number(client.price_amount || 0);
    if (priceAmount > 0 && priceAmount < standardPrice) continue;

    // Preço que a conta realmente paga numa renovação simples (mesma
    // regra de create-payment/route.ts:224 — Regra 1): o price_amount
    // dela, quando setado, mesmo que seja MAIOR que o padrão (ex: conta
    // com mais telas). Só cai pro padrão da tabela se nunca foi
    // precificada individualmente.
    const normalPrice = priceAmount > 0 ? priceAmount : standardPrice;

    eligibleAccounts.push({
      client,
      normalPrice,
      discountedPrice: computeDiscountedPrice(normalPrice, discountType, discountValue),
    });
  }

  // Agrupa por pessoa (whatsapp) e mostra TODAS as contas dela — não só a
  // elegível — pra dar contexto (ex: "Insqueixa" sozinho não diz em qual
  // servidor; com as contas-irmãs junto fica claro).
  const eligibleIds = new Set(eligibleAccounts.map((e) => e.client.id));
  const waWithEligible = new Set(
    eligibleAccounts.map((e) => e.client.whatsapp_username).filter((w): w is string => !!w),
  );

  const groupsMap = new Map<string, ImpactPersonGroup>();
  function addAccount(
    client: ClientLite,
    eligible: boolean,
    normalPrice: number | null,
    discountedPrice: number | null,
  ) {
    const key = client.whatsapp_username || `solo:${client.id}`;
    let group = groupsMap.get(key);
    if (!group) {
      group = { key, name: client.client_name || "—", accounts: [] };
      groupsMap.set(key, group);
    }
    group.accounts.push({
      id: client.id,
      username: client.username || "—",
      serverName: client.server_name || "—",
      eligible,
      normalPrice,
      discountedPrice,
    });
  }

  for (const e of eligibleAccounts) {
    addAccount(e.client, true, e.normalPrice, e.discountedPrice);
  }
  for (const c of allClients) {
    if (eligibleIds.has(c.id)) continue;
    if (!c.whatsapp_username || !waWithEligible.has(c.whatsapp_username)) continue;
    addAccount(c, false, null, null);
  }

  const groups = Array.from(groupsMap.values());

  return {
    totalClients: eligibleAccounts.length,
    totalNormal: eligibleAccounts.reduce((sum, e) => sum + e.normalPrice, 0),
    totalDiscounted: eligibleAccounts.reduce((sum, e) => sum + e.discountedPrice, 0),
    groups,
  };
}

/** Preço normal x com desconto de UM cliente específico — usado no cupom pessoal. */
export async function computeSingleClientImpact(params: {
  tenantId: string;
  clientId: string;
  discountType: "percent" | "fixed";
  discountValue: number;
}): Promise<ImpactClientRow | null> {
  const { tenantId, clientId, discountType, discountValue } = params;

  const [{ data: clientData }, { data: planTablesData }] = await Promise.all([
    supabaseBrowser
      .from("vw_clients_list_active")
      .select(CLIENT_SELECT)
      .eq("tenant_id", tenantId)
      .eq("id", clientId)
      .maybeSingle(),
    supabaseBrowser
      .from("plan_tables")
      .select("id, currency, is_system_default")
      .eq("tenant_id", tenantId)
      .eq("is_active", true),
  ]);

  const client = clientData as ClientLite | null;
  const planTables = (planTablesData as PlanTableLite[]) || [];
  if (!client || client.price_currency !== "BRL") return null;

  const planTableId = resolveBRLPlanTable(planTables, client);
  if (!planTableId) return null;

  const period = LABEL_TO_PERIOD[String(client.plan_name || "").trim()];
  if (!period) return null;

  const screens = Number(client.screens || 1);

  const { data: itemsData } = await supabaseBrowser
    .from("plan_table_items")
    .select("period, plan_table_item_prices(screens_count, price_amount)")
    .eq("plan_table_id", planTableId)
    .eq("period", period)
    .maybeSingle();

  const standardPrice = (itemsData as any)?.plan_table_item_prices?.find(
    (p: any) => p.screens_count === screens,
  )?.price_amount;
  if (standardPrice == null) return null;

  const priceAmount = Number(client.price_amount || 0);
  const normalPrice = priceAmount > 0 ? priceAmount : Number(standardPrice);

  return {
    id: client.id,
    name: client.client_name || "—",
    username: client.username || "—",
    normalPrice,
    discountedPrice: computeDiscountedPrice(normalPrice, discountType, discountValue),
  };
}
