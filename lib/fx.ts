// lib/fx.ts
// Conversão de moeda usando tenant_fx_rates (mesma tabela/fonte já usada em
// app/admin/revendedor/recarga_revenda.tsx). BRL é o "pivô": toda taxa na
// tabela é sempre "X_to_brl".

export type SupportedCurrency = "BRL" | "USD" | "EUR";

type SupabaseLike = {
  from: (table: string) => any;
};

async function getFxRateToBRL(
  supabase: SupabaseLike,
  tenantId: string,
  currency: SupportedCurrency,
): Promise<number> {
  if (currency === "BRL") return 1;

  const col = currency === "USD" ? "usd_to_brl" : "eur_to_brl";
  const { data, error } = await supabase
    .from("tenant_fx_rates")
    .select(col)
    .eq("tenant_id", tenantId)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const rate = Number((data as any)?.[col]);
  if (error || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Câmbio de ${currency} não configurado (tenant_fx_rates).`);
  }
  return rate;
}

/**
 * Converte um valor de uma moeda pra outra usando o câmbio do tenant.
 * Quando as moedas são iguais, devolve o valor original (2 casas decimais).
 * Quando são diferentes, arredonda pra CIMA no valor inteiro (ex: 5.54 EUR
 * vira 6 EUR) — margem de segurança pra nunca cobrar menos que o devido por
 * causa de flutuação cambial.
 */
export async function convertAmount(
  supabase: SupabaseLike,
  tenantId: string,
  amount: number,
  fromCurrency: string,
  toCurrency: string,
): Promise<number> {
  const from = (fromCurrency || "BRL").toUpperCase() as SupportedCurrency;
  const to = (toCurrency || "BRL").toUpperCase() as SupportedCurrency;

  if (from === to) return Math.round(amount * 100) / 100;

  const fromRate = await getFxRateToBRL(supabase, tenantId, from);
  const toRate = await getFxRateToBRL(supabase, tenantId, to);

  const amountInBRL = amount * fromRate;
  const amountInTarget = amountInBRL / toRate;

  return Math.ceil(amountInTarget);
}
