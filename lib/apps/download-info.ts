// lib/apps/download-info.ts
// ✅ 04/10/2026, pedido do Márcio: download por aparelho (apps.download_info).
//   Computador                      → pc_url (botão "Baixar")
//   Android / Google TV / Fire TV   → downloader_code (app Downloader)
//   iPhone                          → ios_url (App Store oficial — evita app falso)
// Campo vazio = usa o que a AtivaApp manda no catálogo (appativa_meta:
// downloader_code, links.microsoft, links.apple). Nada nos dois = não mostra.

export type DownloadInfo = {
  pc_url?: string | null;
  downloader_code?: string | null;
  ios_url?: string | null;
};

export type DownloadHint =
  | { kind: "pc"; url: string }
  | { kind: "downloader"; code: string }
  | { kind: "ios"; url: string };

const DOWNLOADER_DEVICES = new Set(["ANDROID_PHONE", "ANDROID_TV", "FIRE_TV"]);

const clean = (v: unknown) => String(v ?? "").trim();
const isUrl = (v: string) => /^https?:\/\//i.test(v);

export function resolveDownloadHint(
  app: { download_info?: DownloadInfo | null; appativa_meta?: any },
  deviceType: string | null | undefined,
): DownloadHint | null {
  const own = app.download_info || {};
  const ativa = app.appativa_meta || {};
  const links = ativa.links || {};
  const dt = String(deviceType || "").toUpperCase();

  if (dt === "COMPUTADOR") {
    const url = clean(own.pc_url) || clean(links.microsoft);
    return isUrl(url) ? { kind: "pc", url } : null;
  }
  if (DOWNLOADER_DEVICES.has(dt)) {
    const code = clean(own.downloader_code) || clean(ativa.downloader_code);
    return code ? { kind: "downloader", code } : null;
  }
  if (dt === "IOS") {
    const url = clean(own.ios_url) || clean(links.apple);
    return isUrl(url) ? { kind: "ios", url } : null;
  }
  return null;
}
