"use client";
// lib/apps/duplecast-extension.ts
// DupleCast (duplecast.com) — sem API server-side própria (a antiga foi
// bloqueada pelo Cloudflare, ver app/api/integrations/apps/duplecast/route.ts),
// tudo via extensão do Chrome. Mesmo motivo do ClouDDy/IBOSOL: só passa numa
// aba REAL (chrome.tabs.create, sem CDP) — ver histórico em
// unigestor-extensao/background.js. Mesmo protocolo de mensagem
// (window.dispatchEvent/addEventListener) de lib/apps/clouddy-extension.ts.
export type DuplecastAction = "DUPLECAST_CONFIGURE" | "DUPLECAST_CHECK" | "DUPLECAST_DELETE";
export type DuplecastResult = {
  ok: boolean;
  error?: string;
  notFound?: boolean;
  expireDate?: string | null;
  isTrial?: boolean;
};

export function dispatchDuplecastAction(action: DuplecastAction, payload: Record<string, unknown>): Promise<DuplecastResult> {
  return new Promise((resolve) => {
    const responseHandler = (e: any) => {
      window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);
      const detail = e.detail || {};
      resolve(
        detail.ok
          ? { ok: true, ...(detail.data || {}) }
          : { ok: false, error: detail.error || "Falha desconhecida.", notFound: detail.notFound },
      );
    };
    window.addEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);

    window.dispatchEvent(new CustomEvent("UNIGESTOR_INTEGRATION_CALL", { detail: { action, payload } }));

    setTimeout(() => {
      window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);
      resolve({ ok: false, error: "Sem resposta em 90s — confira a aba do Duplecast (pode estar esperando o Cloudflare)." });
    }, 90000);
  });
}
