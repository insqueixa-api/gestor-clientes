// app/admin/settings/cupons/impact_preview.ts
// Prévia de impacto de um cupom: quantos clientes seriam elegíveis hoje e
// qual seria o valor total de renovação normal vs. com o cupom aplicado,
// se todos renovassem agora nas condições atuais. Roda 100% no browser via
// supabaseBrowser (RLS já libera clients/plan_tables/plan_table_items/
// plan_table_item_prices pro authenticated do próprio tenant) — mesmo
// padrão já usado em app/admin/gerenciador/cobranca/page.tsx (cálculo
// client-side sobre os clientes carregados).
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

export type ImpactClientRow = {
  id: string;
  name: string;
  username: string;
  normalPrice: number;
  discountedPrice: number;
};

export type ImpactResult = {
  totalClients: number;
  totalNormal: number;
  totalDiscounted: number;
  clients: ImpactClientRow[];
};

type PlanTableLite = { id: string; currency: string; is_system_default: boolean };

type ClientLite = {
  id: string;
  display_name: string | null;
  username: string | null;
  plan_label: string | null;
  screens: number | null;
  price_currency: string | null;
  price_amount: number | null;
  plan_table_id: string | null;
  created_at: string | null;
};

/** Resolve a tabela de preço BRL do cliente. Retorna null se não achar uma tabela BRL. */
function resolveBRLPlanTable(planTables: PlanTableLite[], client: ClientLite): string | null {
  if (client.plan_table_id) {
    const pt = planTables.find((t) => t.id === client.plan_table_id);
    if (pt && pt.currency === "BRL") return pt.id;
  }
  const def = planTables.find((t) => t.is_system_default && t.currency === "BRL");
  return def ? def.id : null;
}

function ageInDays(createdAt: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(createdAt).getTime()) / 86400000);
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

export async function computeCouponImpact(params: {
  tenantId: string;
  discountType: "percent" | "fixed";
  discountValue: number;
  minAccountAgeDays: number | null;
  excludeCouponId?: string;
}): Promise<ImpactResult> {
  const { tenantId, discountType, discountValue, minAccountAgeDays, excludeCouponId } = params;

  const [{ data: clientsData }, { data: planTablesData }] = await Promise.all([
    supabaseBrowser
      .from("clients")
      .select("id, display_name, username:server_username, plan_label, screens, price_currency, price_amount, plan_table_id, created_at")
      .eq("tenant_id", tenantId)
      .eq("is_archived", false)
      .eq("is_trial", false)
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

  let excludedClientIds: Set<string> | null = null;
  if (excludeCouponId) {
    const { data: redemptions } = await supabaseBrowser
      .from("coupon_redemptions")
      .select("client_id")
      .eq("coupon_id", excludeCouponId);
    excludedClientIds = new Set((redemptions || []).map((r: any) => r.client_id));
  }

  const eligible = allClients.filter((c) => {
    if (Number(c.price_amount || 0) > 0) return false; // preço override
    if (excludedClientIds?.has(c.id)) return false; // já resgatou este cupom
    if (minAccountAgeDays != null) {
      if (!c.created_at) return false;
      if (ageInDays(c.created_at, now) < minAccountAgeDays) return false;
    }
    return true;
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

  const clients: ImpactClientRow[] = [];
  for (const client of eligible) {
    const planTableId = resolveBRLPlanTable(planTables, client);
    if (!planTableId) continue;

    const period = LABEL_TO_PERIOD[String(client.plan_label || "").trim()];
    if (!period) continue;

    const screens = Number(client.screens || 1);
    const normalPrice = priceMap.get(`${planTableId}|${period}|${screens}`);
    if (normalPrice == null) continue;

    clients.push({
      id: client.id,
      name: client.display_name || "—",
      username: client.username || "—",
      normalPrice,
      discountedPrice: computeDiscountedPrice(normalPrice, discountType, discountValue),
    });
  }

  return {
    totalClients: clients.length,
    totalNormal: clients.reduce((sum, c) => sum + c.normalPrice, 0),
    totalDiscounted: clients.reduce((sum, c) => sum + c.discountedPrice, 0),
    clients,
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
      .from("clients")
      .select("id, display_name, username:server_username, plan_label, screens, price_currency, price_amount, plan_table_id, created_at")
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

  const period = LABEL_TO_PERIOD[String(client.plan_label || "").trim()];
  if (!period) return null;

  const screens = Number(client.screens || 1);

  const { data: itemsData } = await supabaseBrowser
    .from("plan_table_items")
    .select("period, plan_table_item_prices(screens_count, price_amount)")
    .eq("plan_table_id", planTableId)
    .eq("period", period)
    .maybeSingle();

  const normalPrice = (itemsData as any)?.plan_table_item_prices?.find(
    (p: any) => p.screens_count === screens,
  )?.price_amount;
  if (normalPrice == null) return null;

  return {
    id: client.id,
    name: client.display_name || "—",
    username: client.username || "—",
    normalPrice: Number(normalPrice),
    discountedPrice: computeDiscountedPrice(Number(normalPrice), discountType, discountValue),
  };
}
