"use client";
// components/apps/DownloadHintCard.tsx
// ✅ 04/10/2026, pedido do Márcio: download do aplicativo pro aparelho que o
// cliente escolheu (resolvido no servidor — lib/apps/download-info.ts).
// Compacto, uma linha: ícone (o mesmo do cadastro) + ação.
//   pc / ios   → "Baixar" (link)
//   downloader → código copiável
import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import type { DownloadHint } from "@/lib/apps/download-info";
import DownloadKindIcon, { DOWNLOAD_KIND_LABEL } from "@/components/apps/DownloadKindIcon";

export default function DownloadHintCard({ hint }: { hint: DownloadHint | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!hint) return null;

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2">
      <DownloadKindIcon kind={hint.kind} size={26} src={hint.logo} />
      <span className="text-xs font-semibold text-foreground">{DOWNLOAD_KIND_LABEL[hint.kind]}</span>
      <span className="flex-1" />
      {hint.kind === "downloader" ? (
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(hint.code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              /* sem permissão de clipboard — o código continua visível */
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1 font-mono text-sm font-semibold text-foreground hover:bg-muted transition-colors"
          title="Copiar código do Downloader"
        >
          {hint.code}
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
        </button>
      ) : (
        <a
          href={hint.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 px-3 py-1 text-xs font-bold text-white transition-colors"
        >
          Baixar
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
}
