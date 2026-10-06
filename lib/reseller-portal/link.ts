// lib/reseller-portal/link.ts
// ✅ 06/10/2026: {link_pagamento} quando o destino da mensagem é REVENDA —
// link do Portal da Revenda (antes a revenda passava pelo generatePortalLink
// do cliente, que não acha cliente pro telefone dela e devolvia vazio).
// Fica FORA de lib/whatsapp/template-vars.ts de propósito: aquele arquivo é
// importado por telas do navegador (via lib/apps/license-text), e este usa
// `crypto` do Node (lib/reseller-portal/session.ts) — só servidor.
import { getOrCreateResellerPortalToken, resellerPortalUrl } from "@/lib/reseller-portal/session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateResellerPortalLink(
  sb: any,
  params: { tenantId: string; resellerId: string; createdBy?: string | null; label: string; onLog?: (...args: any[]) => void },
): Promise<string> {
  const log = params.onLog || (() => {});
  try {
    const token = await getOrCreateResellerPortalToken(sb, {
      tenantId: params.tenantId,
      resellerId: params.resellerId,
      createdBy: params.createdBy && UUID_RE.test(params.createdBy) ? params.createdBy : null,
      label: params.label,
    });
    log("[PORTAL_REVENDA][token]", { ok: !!token, token_suffix: token ? token.slice(-6) : null });
    return token ? resellerPortalUrl(token) : "";
  } catch (e: any) {
    log("[PORTAL_REVENDA][token] falhou", e?.message ?? e);
    return "";
  }
}
