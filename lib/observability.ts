// lib/observability.ts
// Ponto único pra sinalizar tentativa de acesso indevido — usado só nos
// pontos de rejeição por FALTA DE PERMISSÃO (403 / secret interno errado),
// nunca pra 401 comum (sessão expirada, sem token). Só console.error —
// visível nos logs da Vercel, sem depender de serviço externo nenhum.
export function flagSuspiciousAccess(reason: string, context: Record<string, unknown> = {}) {
  console.error(`[acesso_negado] ${reason}`, context);
}
