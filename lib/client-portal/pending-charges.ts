// lib/client-portal/pending-charges.ts
import { convertAmount } from "@/lib/fx";

export type PendingChargeItem = {
  id: string;
  message: string;
  amount: number;
  currency: string;
  convertedAmount: number;
  appName: string | null;
  activationDate: string | null;
};

export type PendingChargesResult = {
  items: PendingChargeItem[];
  total: number;
  alertIds: string[];
};

/**
 * Busca as pendências financeiras (client_alerts com amount preenchido e
 * status OPEN) de um cliente, convertendo cada uma pra targetCurrency (a
 * moeda que o cliente está pagando agora). Usado tanto no preview do portal
 * quanto no create-payment (que recalcula tudo de novo, nunca confia no que
 * o preview mandou).
 */
export async function getPendingCharges(
  supabaseAdmin: any,
  tenantId: string,
  clientId: string,
  targetCurrency: string,
): Promise<PendingChargesResult> {
  const { data, error } = await supabaseAdmin
    .from("client_alerts")
    .select("id, message, amount, currency, activation_date, client_apps(apps(name))")
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .eq("status", "OPEN")
    .not("amount", "is", null)
    .order("created_at", { ascending: true });

  if (error || !data?.length) {
    return { items: [], total: 0, alertIds: [] };
  }

  const items: PendingChargeItem[] = [];
  for (const row of data as any[]) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const fromCurrency = String(row.currency || "BRL");
    const convertedAmount = await convertAmount(
      supabaseAdmin,
      tenantId,
      amount,
      fromCurrency,
      targetCurrency,
    );

    items.push({
      id: String(row.id),
      message: String(row.message || ""),
      amount,
      currency: fromCurrency,
      convertedAmount,
      appName: row.client_apps?.apps?.name ?? null,
      activationDate: row.activation_date ?? null,
    });
  }

  const total = items.reduce((sum, it) => sum + it.convertedAmount, 0);
  return { items, total, alertIds: items.map((it) => it.id) };
}
