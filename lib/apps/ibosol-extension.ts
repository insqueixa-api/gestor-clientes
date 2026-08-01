"use client";
// lib/apps/ibosol-extension.ts
// IBOSOL (ibosol.com) — volta só pra checar o vencimento real do Duplex TV
// (o painel do Duplex TV, duplex24.com, não tem endpoint de status pra MAC
// já ativado — ver app/api/integrations/apps/duplextv/route.ts). Sem
// INTEGRATION_REGISTRY/rota de API própria, tudo via extensão do Chrome —
// mesmo motivo do ClouDDy (Cloudflare Turnstile real no login, só passa
// numa aba de verdade). Mesmo protocolo de mensagem (ver
// lib/apps/clouddy-extension.ts) — só a ação muda.
export type IbosolAction = "IBOSOL_CHECK_DUPLEXTV";
export type IbosolResult = { ok: boolean; error?: string; expireDate?: string | null; macStatus?: string | null };

export function dispatchIbosolAction(action: IbosolAction, payload: Record<string, unknown>): Promise<IbosolResult> {
  return new Promise((resolve) => {
    const responseHandler = (e: any) => {
      window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);
      resolve(e.detail?.ok ? e.detail : { ok: false, error: e.detail?.error || "Falha desconhecida." });
    };
    window.addEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);

    window.dispatchEvent(new CustomEvent("UNIGESTOR_INTEGRATION_CALL", { detail: { action, payload } }));

    setTimeout(() => {
      window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);
      resolve({ ok: false, error: "Sem resposta em 90s — confira a aba do IBOSOL (pode estar esperando você resolver o captcha)." });
    }, 90000);
  });
}
