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
//
// ✅ 07/10/2026: SET IPTV (cms.manage-setiptv.com) também é via extensão —
// formulário com reCAPTCHA v3, roda na aba real do Chrome do Márcio usando os
// próprios botões do site (unigestor-extensao/background.js, SETIPTV_*).
export type ClouddyAction = "CLOUDDY_CONFIGURE" | "CLOUDDY_CHECK" | "CLOUDDY_DELETE";
export type ClouddyResult = { ok: boolean; error?: string; expireDate?: string | null };

export type SetIptvAction = "SETIPTV_CONFIGURE" | "SETIPTV_DELETE" | "SETIPTV_CHECK";
export type SetIptvResult = {
  ok: boolean;
  error?: string;
  mode?: "updated" | "added" | "added_without_load";
  removed?: "one" | "none";
  message?: string;
  // action=check do site: paid=true → licença vitalícia (vencimento 31/12/9999)
  check?: { http?: number; paid?: boolean | null; raw?: string; error?: string } | null;
};

function dispatchExtensionAction<T extends { ok: boolean; error?: string }>(
  action: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const responseHandler = (e: any) => {
      if (done) return;
      done = true;
      window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);
      resolve(e.detail?.ok ? e.detail : ({ ok: false, error: e.detail?.error || "Falha desconhecida." } as T));
    };
    window.addEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);

    window.dispatchEvent(new CustomEvent("UNIGESTOR_INTEGRATION_CALL", { detail: { action, payload } }));

    setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);
      resolve({ ok: false, error: timeoutMessage } as T);
    }, timeoutMs);
  });
}

export function dispatchClouddyAction(action: ClouddyAction, payload: Record<string, unknown>): Promise<ClouddyResult> {
  return dispatchExtensionAction<ClouddyResult>(
    action,
    payload,
    90000,
    "Sem resposta em 90s — confira a aba do ClouDDy (pode estar esperando você resolver o captcha).",
  );
}

export function dispatchSetIptvAction(action: SetIptvAction, payload: Record<string, unknown>): Promise<SetIptvResult> {
  return dispatchExtensionAction<SetIptvResult>(
    action,
    payload,
    // carregar (até 45s) + envio (até 2,5 min, se o site pedir algo à pessoa)
    240000,
    "Sem resposta em 4 min — confira a aba do SET IPTV (pode estar esperando você aceitar os cookies ou digitar o código).",
  );
}
