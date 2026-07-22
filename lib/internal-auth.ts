// lib/internal-auth.ts
// Autenticação server-to-server via header x-internal-secret — mesmo padrão
// já usado em app/api/integrations/{natv,fast,elite}/*/route.ts. Comparação
// em tempo constante (crypto.timingSafeEqual), falha fechada se qualquer
// lado estiver vazio.
import crypto from "crypto";

export function isInternalRequest(req: Request | { headers: Headers }): boolean {
  const expected = process.env.INTERNAL_API_SECRET || "";
  const received = req.headers.get("x-internal-secret") || "";
  if (!expected || !received) return false;

  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// true quando um header x-internal-secret foi enviado mas está errado —
// nesse caso a rota deve rejeitar (401) em vez de cair pro fluxo de sessão.
export function hasBadInternalHeader(req: Request | { headers: Headers }): boolean {
  const hasHeader = !!req.headers.get("x-internal-secret");
  return hasHeader && !isInternalRequest(req);
}
