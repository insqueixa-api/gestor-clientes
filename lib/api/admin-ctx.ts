// lib/api/admin-ctx.ts
// ✅ Módulo neutro (zero imports de next/headers ou next/server) só com o
// formato do cookie "admin_ctx" e sua função de parse. Existe separado de
// lib/api/auth-server.ts porque esse arquivo é importado tanto de Server
// Components/Actions (via next/headers) quanto de proxy.ts (middleware,
// Edge Runtime) — next/headers não pode ser importado em Middleware, então
// esse pedaço compartilhado precisa ficar livre de qualquer import
// específico de runtime.

export const ADMIN_CTX_COOKIE = "admin_ctx";
export const ADMIN_CTX_MAX_AGE = 60 * 60 * 24 * 400; // ~400 dias (teto do RFC6265bis) — na prática "até o logoff"

// ✅ Janela de revalidação do auth.getUser() (bate no servidor de Auth do
// Supabase) — pedido do Marcio, 05/08/2026: único usuário do sistema, não
// precisa reconfirmar a sessão a cada navegação/prefetch, só 1x por dia.
// Fora dessa janela, getAdminTenantContext confia na sessão local
// (supabase.auth.getSession(), sem round-trip) até completar 24h.
export const ADMIN_CTX_REVALIDATE_MS = 1000 * 60 * 60 * 24;

export type AdminCtxCookiePayload = {
  userId: string;
  tenantId: string;
  role: string;
  tenantName: string | null;
  displayName: string | null;
  verifiedAt: number;
};

export function parseAdminCtxCookie(raw: string | undefined | null, userId: string): AdminCtxCookiePayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AdminCtxCookiePayload;
    if (parsed.userId !== userId) return null; // sessão trocou de usuário — não reaproveita
    return parsed;
  } catch {
    return null;
  }
}

// ✅ Extrai um cookie do header Cookie cru (Request.headers.get("cookie")) —
// usado em lib/api/auth.ts (requireAdminTenant), que recebe um Request de
// Web API puro, sem o helper de cookies do NextRequest/next-headers.
export function extractCookieValue(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}
