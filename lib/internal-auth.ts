// lib/internal-auth.ts
// Autenticação server-to-server — fonte única pra toda comparação de secret
// interno do projeto (VM, whatsapp-service, Vercel Cron). Sempre em tempo
// constante (crypto.timingSafeEqual), falha fechada se qualquer lado estiver
// vazio ou com tamanho diferente.
import crypto from "crypto";
import { flagSuspiciousAccess } from "@/lib/observability";

function timingSafeCompare(received: string, expected: string): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Header x-internal-secret — usado pela VM/whatsapp-service e por
// integrações internas. secretEnvVar permite reaproveitar o mesmo mecanismo
// com um secret diferente do padrão (ex: UNIGESTOR_BOT_INTERNAL_SECRET),
// sem duplicar a lógica de comparação em cada rota.
export function isInternalRequest(
  req: Request | { headers: Headers },
  secretEnvVar: string = "INTERNAL_API_SECRET"
): boolean {
  const expected = process.env[secretEnvVar] || "";
  const received = req.headers.get("x-internal-secret") || "";
  return timingSafeCompare(received, expected);
}

// true quando um header x-internal-secret foi enviado mas está errado —
// nesse caso a rota deve rejeitar (401) em vez de cair pro fluxo de sessão.
export function hasBadInternalHeader(
  req: Request | { headers: Headers },
  secretEnvVar: string = "INTERNAL_API_SECRET"
): boolean {
  const hasHeader = !!req.headers.get("x-internal-secret");
  const bad = hasHeader && !isInternalRequest(req, secretEnvVar);
  if (bad) flagSuspiciousAccess("x_internal_secret_invalido", { secretEnvVar });
  return bad;
}

// Header Authorization: Bearer <secret> — usado pelo Vercel Cron. Mesmo
// mecanismo de comparação em tempo constante, mas convenção de header
// diferente (é o formato que o Vercel Cron manda, não dá pra mudar isso
// sem mexer na config do cron).
export function isCronRequest(req: Request | { headers: Headers }, secretEnvVar: string): boolean {
  const expected = process.env[secretEnvVar] || "";
  const authHeader = req.headers.get("authorization") || "";
  const received = authHeader.replace(/^Bearer\s+/i, "").trim();
  return timingSafeCompare(received, expected);
}
