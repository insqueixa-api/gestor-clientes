// lib/client-portal/app-renewal-charges.ts
import { convertAmount } from "@/lib/fx";

export type AppRenewalChargeItem = {
  client_app_id: string;
  app_name: string;
  price_amount: number;
  price_currency: string;
};

export type AppRenewalChargesResult = {
  items: AppRenewalChargeItem[];
  total: number;
};

/**
 * Busca e valida, DE NOVO no servidor (nunca confia em preço vindo do
 * front), o preço de licença dos apps que o cliente pediu pra embutir no
 * pagamento combinado do plano — mesma regra de elegibilidade de
 * app/api/client-portal/apps/renew-payment/route.ts: cost_type='paid',
 * license_price > 0, app não descontinuado (apps.is_active !== false).
 * client_app_ids que não pertencem a este client_id, que não existem, ou
 * que não são elegíveis são silenciosamente ignorados (fail-open — mesmo
 * espírito de getPendingCharges/validateCouponForCharge: nunca derruba o
 * pagamento do plano por causa de uma seleção de app inválida vinda do
 * front).
 *
 * license_price é sempre cadastrado em BRL — convertAmount() já arredonda
 * pra cima (Math.ceil) em qualquer conversão cruzada, então R$30 vira 7
 * USD/EUR (não 6,01), mantendo os centavos exatos só quando
 * targetCurrency já é BRL.
 */
export async function getAppRenewalCharges(
  supabaseAdmin: any,
  tenantId: string,
  clientId: string,
  clientAppIds: string[],
  targetCurrency: string,
): Promise<AppRenewalChargesResult> {
  const ids = [
    ...new Set((clientAppIds || []).map((v) => String(v || "").trim()).filter(Boolean)),
  ];
  if (!ids.length) return { items: [], total: 0 };

  const { data, error } = await supabaseAdmin
    .from("client_apps")
    .select("id, client_id, apps(name, cost_type, license_price, is_active)")
    .eq("client_id", clientId)
    .in("id", ids);

  if (error || !data?.length) return { items: [], total: 0 };

  const currency = String(targetCurrency || "BRL");
  const items: AppRenewalChargeItem[] = [];
  for (const row of data as any[]) {
    // ✅ nunca confia em client_app_id sem checar posse — a query já filtrou
    // .eq("client_id", clientId), reforça aqui contra qualquer regressão
    // futura no filtro acima.
    if (String(row.client_id) !== String(clientId)) continue;

    const appMeta = Array.isArray(row.apps) ? row.apps[0] : row.apps;
    if (!appMeta) continue;
    if (appMeta.is_active === false) continue; // descontinuado
    if (appMeta.cost_type !== "paid") continue; // parceria/gratuito — nada a cobrar
    const priceBRL = Number(appMeta.license_price || 0);
    if (!Number.isFinite(priceBRL) || priceBRL <= 0) continue;

    const priceAmount = await convertAmount(supabaseAdmin, tenantId, priceBRL, "BRL", currency);

    items.push({
      client_app_id: String(row.id),
      app_name: String(appMeta.name || "Aplicativo"),
      price_amount: priceAmount,
      price_currency: currency,
    });
  }

  const total = Number(items.reduce((sum, it) => sum + it.price_amount, 0).toFixed(2));
  return { items, total };
}
