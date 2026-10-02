// lib/apps/license-text.ts
// Texto da variável {licenca} das instruções dos apps (ex: "R$ 30,00 por
// ano, por aparelho") — a licença é por aparelho (cada um tem o seu MAC e a
// sua ativação). Fonte única: portal (apps/list, apps/catalog) e seletor de
// apps do admin. 02/10/2026.
import { renderTemplate } from "@/lib/whatsapp/template-vars";

export function formatLicenca(
  price: number | null | undefined,
  currency: string | null | undefined,
  period: string | null | undefined,
): string {
  if (price == null || !(Number(price) > 0)) return "";
  const value = new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(Number(price));
  return `${value}${
    period === "annual" ? " por ano, por aparelho" : period === "lifetime" ? " (pagamento único), por aparelho" : " por aparelho"
  }`;
}

/** Instruções do app com {licenca} preenchida (as outras variáveis ficam como estão). */
export function renderAppDescription(
  text: string | null | undefined,
  licenca: string,
  extraVars: Record<string, string> = {},
): string | null {
  if (!text) return null;
  return renderTemplate(text, { ...extraVars, licenca });
}
