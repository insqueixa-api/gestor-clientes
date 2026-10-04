"use client";
// components/apps/DownloadHintCard.tsx
// ✅ 04/10/2026, pedido do Márcio: download do aplicativo pro aparelho que o
// cliente escolheu (resolvido no servidor — lib/apps/download-info.ts).
// Uma linha baixa: a logo ORIGINAL à esquerda (a que o Márcio sobe na tela de
// Aplicativos, sem cortar) e a ação à direita.
//   pc / ios   → "Clique aqui para download ↓"
//   downloader → código copiável
import { useState } from "react";
import { Copy, Check, ArrowDownToLine } from "lucide-react";
import type { DownloadHint } from "@/lib/apps/download-info";
import DownloadKindIcon, { DOWNLOAD_KIND_LABEL } from "@/components/apps/DownloadKindIcon";

export default function DownloadHintCard({ hint }: { hint: DownloadHint | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!hint) return null;

  const logo = (
    <span className="flex items-center gap-2 min-w-0">
      <DownloadKindIcon kind={hint.kind} size={28} src={hint.logo} natural />
      {!hint.logo && <span className="text-sm font-semibold text-foreground">{DOWNLOAD_KIND_LABEL[hint.kind]}</span>}
    </span>
  );

  if (hint.kind === "downloader") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2">
        {logo}
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
      </div>
    );
  }

  return (
    <a
      href={hint.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 hover:border-sky-500/40 hover:bg-sky-500/5 transition-colors"
    >
      {logo}
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-600 dark:text-sky-400 shrink-0">
        Clique aqui para download
        <ArrowDownToLine className="w-4 h-4" />
      </span>
    </a>
  );
}
