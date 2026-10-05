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

// logo = a que o Márcio sobe na tela de Aplicativos (tabela app_download_logos)
export type DownloadHint = (
  | { kind: "pc"; url: string }
  | { kind: "downloader"; code: string }
  | { kind: "ios"; url: string }
) & { logo?: string | null };

export type DownloadLogos = {
  pc_logo_url?: string | null;
  downloader_logo_url?: string | null;
  ios_logo_url?: string | null;
};

/** Junta a logo da conta (app_download_logos) ao download já resolvido. */
export function withDownloadLogo(hint: DownloadHint | null, logos: DownloadLogos | null | undefined): DownloadHint | null {
  if (!hint) return null;
  const logo =
    hint.kind === "pc" ? logos?.pc_logo_url : hint.kind === "ios" ? logos?.ios_logo_url : logos?.downloader_logo_url;
  return { ...hint, logo: logo || null };
}

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

/**
 * ✅ 05/10/2026, achado do Márcio (Cortex no Xbox, "Detalhes" da vitrine): o
 * texto de configuração é UM por app e fala do link de download "acima" —
 * mas o card só existe quando o aparelho tem link/código. Sem o card de
 * computador em cima, a frase sai do texto (vale pra vitrine e pra página
 * do app já adicionado).
 */
export function adaptSetupText(text: string | null | undefined, hint: DownloadHint | null | undefined): string | null {
  if (!text) return text ?? null;
  if (hint?.kind === "pc") return text;
  return text.replace(/\s*\(no computador, use o link de download acima\)/gi, "");
}

/**
 * Download pra mostrar no "Detalhes" da vitrine: o do aparelho escolhido;
 * sem aparelho escolhido, só se TODOS os aparelhos do app derem o mesmo
 * (ex: Elite P2P, sempre pelo Downloader) — senão não chuta nenhum.
 */
export function pickCatalogDownload(
  downloads: Record<string, DownloadHint | null> | null | undefined,
  deviceType: string | null | undefined,
): DownloadHint | null {
  if (!downloads) return null;
  if (deviceType && deviceType in downloads) return downloads[deviceType] || null;
  const all = Object.values(downloads);
  if (!all.length || all.some((h) => !h)) return null;
  const key = (h: DownloadHint) => `${h.kind}:${"url" in h ? h.url : h.code}`;
  const first = key(all[0] as DownloadHint);
  return all.every((h) => key(h as DownloadHint) === first) ? (all[0] as DownloadHint) : null;
}
