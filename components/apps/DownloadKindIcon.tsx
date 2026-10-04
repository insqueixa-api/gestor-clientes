"use client";
// components/apps/DownloadKindIcon.tsx
// ✅ 04/10/2026: ícone de cada tipo de download — o MESMO no cadastro do app
// (admin) e no portal. `src` = logo que o Márcio sobe na tela de Aplicativos
// (tabela app_download_logos); sem logo (ou se a imagem falhar), ícone padrão.
import { useState } from "react";
import { Download, Apple, Monitor } from "lucide-react";

export type DownloadKind = "pc" | "downloader" | "ios";

export const DOWNLOAD_KIND_LABEL: Record<DownloadKind, string> = {
  pc: "Computador",
  downloader: "Downloader",
  ios: "iPhone",
};

export default function DownloadKindIcon({
  kind,
  size = 20,
  src,
  natural = false,
}: {
  kind: DownloadKind;
  size?: number;
  src?: string | null;
  // natural = logo na proporção original (altura = size, largura automática,
  // sem cortar) — usado no portal; sem isso é o quadradinho do admin.
  natural?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const box = { width: size, height: size };
  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt={DOWNLOAD_KIND_LABEL[kind]}
        style={natural ? { height: size, width: "auto", maxWidth: size * 5 } : box}
        className={natural ? "object-contain shrink-0" : "rounded-md object-cover shrink-0"}
        onError={() => setFailed(src)}
      />
    );
  }
  const Icon = kind === "ios" ? Apple : kind === "pc" ? Monitor : Download;
  const tone = kind === "downloader" ? "bg-orange-500/15 text-orange-500" : "bg-sky-500/15 text-sky-600 dark:text-sky-400";
  return (
    <span style={box} className={`rounded-md flex items-center justify-center shrink-0 ${tone}`}>
      <Icon style={{ width: size * 0.6, height: size * 0.6 }} />
    </span>
  );
}
