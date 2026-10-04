"use client";
// components/apps/DownloadHintCard.tsx
// ✅ 04/10/2026, pedido do Márcio: download do aplicativo pro aparelho que o
// cliente escolheu (resolvido no servidor — lib/apps/download-info.ts).
//   pc         → botão "Baixar para o computador"
//   downloader → logo do app Downloader + código copiável
//   ios        → botão pra App Store oficial (evita app falso)
// Logo do Downloader: public/downloader-logo.png (se não existir, mostra ícone).
import { useState } from "react";
import { Copy, Check, Download, Apple, Monitor } from "lucide-react";
import type { DownloadHint } from "@/lib/apps/download-info";

export default function DownloadHintCard({ hint }: { hint: DownloadHint | null | undefined }) {
  const [copied, setCopied] = useState(false);
  const [logoOk, setLogoOk] = useState(true);
  if (!hint) return null;

  if (hint.kind === "downloader") {
    return (
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          {logoOk ? (
            <img
              src="/downloader-logo.png"
              alt="Downloader"
              className="w-8 h-8 rounded-lg object-cover"
              onError={() => setLogoOk(false)}
            />
          ) : (
            <span className="w-8 h-8 rounded-lg bg-orange-500/15 text-orange-500 flex items-center justify-center">
              <Download className="w-4 h-4" />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">Instalar pelo Downloader</p>
            <p className="text-[11px] text-muted-foreground">Abra o app Downloader e digite o código:</p>
          </div>
        </div>
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
          className="w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 hover:bg-muted transition-colors"
          title="Copiar código"
        >
          <span className="font-mono text-lg font-bold tracking-widest text-foreground">{hint.code}</span>
          {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
        </button>
      </div>
    );
  }

  const isIos = hint.kind === "ios";
  return (
    <a
      href={hint.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center gap-2 w-full rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold px-4 py-3 transition-colors"
    >
      {isIos ? <Apple className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
      {isIos ? "Baixar na App Store (app oficial)" : "Baixar para o computador"}
    </a>
  );
}
