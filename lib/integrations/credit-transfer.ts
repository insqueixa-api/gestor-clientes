// lib/integrations/credit-transfer.ts
// Servidores (provider da integração) que já enviam crédito pra revenda pela
// API — define quem aparece na "Tabela Revenda" (Tabelas de Preço) e quem
// mostra o envio automático na Recarga rápida. Elite/Fast entram aqui quando
// a API de envio deles for integrada (docs/revenda-portal/PLANO.md).
export const CREDIT_TRANSFER_PROVIDERS = ["NATV"] as const;

export function supportsCreditTransfer(provider: unknown): boolean {
  return (CREDIT_TRANSFER_PROVIDERS as readonly string[]).includes(String(provider || "").toUpperCase());
}

/** Pacotes padrão de uma linha nova da Tabela Revenda. */
export const DEFAULT_CREDIT_PACKAGES = [10, 20, 30, 50, 100];
