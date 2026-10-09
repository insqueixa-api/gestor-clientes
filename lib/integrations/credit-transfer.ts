// lib/integrations/credit-transfer.ts
// Servidores (provider da integração) que já enviam crédito pra revenda pela
// API — define quem aparece na "Tabela Revenda" (Tabelas de Preço) e quem
// mostra o envio automático na Recarga rápida. Fast entra aqui quando a API
// de envio dele for integrada (docs/revenda-portal/PLANO.md).
// ✅ 09/10/2026: Elite (API oficial, mínimo de 20 créditos por envio).
export const CREDIT_TRANSFER_PROVIDERS = ["NATV", "ELITE"] as const;

export function supportsCreditTransfer(provider: unknown): boolean {
  return (CREDIT_TRANSFER_PROVIDERS as readonly string[]).includes(String(provider || "").toUpperCase());
}

/** Mínimo de créditos por envio no painel (NaTV 5 — ou 4 se a revenda tem 1; Elite 20). */
export function minCreditTransfer(provider: unknown): number {
  return String(provider || "").toUpperCase() === "ELITE" ? 20 : 5;
}

/** Nome do painel pra mensagens. */
export function creditProviderLabel(provider: unknown): string {
  const p = String(provider || "").toUpperCase();
  return p === "ELITE" ? "Elite" : p === "NATV" ? "NaTV" : "servidor";
}

/** Pacotes padrão de uma linha nova da Tabela Revenda (Elite: nada abaixo de 20). */
export const DEFAULT_CREDIT_PACKAGES = [10, 20, 30, 50, 100];
export function defaultCreditPackages(provider: unknown): number[] {
  const min = minCreditTransfer(provider);
  return min > 10 ? [20, 30, 50, 100, 200] : DEFAULT_CREDIT_PACKAGES;
}
