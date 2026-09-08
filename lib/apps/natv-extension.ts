"use client";
// lib/apps/natv-extension.ts
// Sync do catálogo NaTV via extensão do Chrome — NaTV bloqueou qualquer IP
// fora do Brasil (08/09/2026), nem a Vercel nem a VM Hetzner conseguem mais
// baixar o M3U deles. O background da extensão baixa (sai pelo IP
// residencial de verdade de quem está com o Chrome aberto, sem CORS graças
// a host_permissions) e devolve o texto puro pra cá — o resto (subir pro R2,
// chamar a rota de sync) roda na própria página, ver ModalCatalogo.tsx.
// Mesmo protocolo de mensagem de lib/apps/clouddy-extension.ts.
export type NatvSyncResult = { ok: boolean; error?: string; m3uText?: string };

export function dispatchNatvSync(m3uUrl: string): Promise<NatvSyncResult> {
  return new Promise((resolve) => {
    const responseHandler = (e: any) => {
      window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);
      resolve(e.detail?.ok ? e.detail : { ok: false, error: e.detail?.error || "Falha desconhecida." });
    };
    window.addEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);

    window.dispatchEvent(
      new CustomEvent("UNIGESTOR_INTEGRATION_CALL", {
        detail: { action: "SYNC_NATV", payload: { m3uUrl } },
      }),
    );

    setTimeout(() => {
      window.removeEventListener("UNIGESTOR_INTEGRATION_RESPONSE", responseHandler);
      resolve({ ok: false, error: "Sem resposta em 60s — confira se a extensão UniGestor Automator está instalada e ativa." });
    }, 60000);
  });
}
