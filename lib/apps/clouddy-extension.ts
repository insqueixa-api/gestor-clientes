"use client";
// lib/apps/clouddy-extension.ts
// ClouDDy (console.clouddy.online) — sem INTEGRATION_REGISTRY/rota de API
// própria, tudo via extensão do Chrome. Motivo: Cloudflare Turnstile real no
// login, só passa numa aba REAL (chrome.tabs.create, sem CDP) — testado
// exaustivamente, ver histórico em novo_cliente.tsx. Protocolo de mensagem
// (window.dispatchEvent/addEventListener) compartilhado aqui entre
// novo_cliente.tsx e AppRequestModal.tsx — cada um decide sozinho quando
// chamar (tem estado de loading/toast próprio), mas o "como conversar com a
// extensão" é um só.
export type ClouddyAction = "CLOUDDY_CONFIGURE" | "CLOUDDY_CHECK" | "CLOUDDY_DELETE";
export type ClouddyResult = { ok: boolean; error?: string; expireDate?: string | null };

export function dispatchClouddyAction(action: ClouddyAction, payload: Record<string, unknown>): Promise<ClouddyResult> {
  return new Promise((resolve) => {
    const responseHandler = (e: any) => {
      window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);
      resolve(e.detail?.ok ? e.detail : { ok: false, error: e.detail?.error || "Falha desconhecida." });
    };
    window.addEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);

    window.dispatchEvent(new CustomEvent("UNIGESTOR_INTEGRATION_CALL", { detail: { action, payload } }));

    setTimeout(() => {
      window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);
      resolve({ ok: false, error: "Sem resposta em 90s — confira a aba do ClouDDy (pode estar esperando você resolver o captcha)." });
    }, 90000);
  });
}
