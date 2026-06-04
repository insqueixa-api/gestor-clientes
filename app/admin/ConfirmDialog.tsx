"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Tone = "emerald" | "rose" | "amber" | "sky" | "slate";

function toneClasses(tone: Tone) {
  switch (tone) {
    case "rose":
      return {
        ring: "shadow-rose-500/30",
        iconBg: "bg-rose-500/20",
        dot: "text-rose-500",
        confirm: "bg-rose-600 hover:bg-rose-500",
      };
    case "amber":
      return {
        ring: "shadow-amber-500/30",
        iconBg: "bg-amber-500/20",
        dot: "text-amber-500",
        confirm: "bg-amber-600 hover:bg-amber-500",
      };
    case "sky":
      return {
        ring: "shadow-sky-500/30",
        iconBg: "bg-sky-500/20",
        dot: "text-sky-500",
        confirm: "bg-sky-600 hover:bg-sky-500",
      };
    case "slate":
      return {
        ring: "shadow-slate-500/20",
        iconBg: "bg-transparent",
        dot: "text-muted-foreground",
        confirm: "bg-slate-800 hover:bg-slate-700",
      };
    default:
      return {
        ring: "shadow-emerald-500/30",
        iconBg: "bg-emerald-500/20",
        dot: "text-emerald-500",
        confirm: "bg-emerald-600 hover:bg-emerald-500",
      };
  }
}

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  details?: (string | React.ReactNode)[]; // ✅ Agora aceita JSX
  tone?: Tone;
  icon?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  subtitle = "Confira os dados antes de confirmar.",
  details = [],
  tone = "emerald",
  icon,
  confirmText = "Confirmar",
  cancelText = "Voltar",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!mounted || !open) return null;

  const t = toneClasses(tone);

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-transparent0 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-200"
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-12 h-12 rounded-full ${t.iconBg} flex items-center justify-center text-2xl`}
          >
            {icon ?? "✅"}
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-foreground truncate">
              {title}
            </h3>
            <p className="text-xs text-foreground/70">
              {subtitle}
            </p>
          </div>
        </div>

        {details.length > 0 && (
          <div className="bg-transparent rounded-xl p-4 border border-border">
            <ul className="space-y-2">
              {details.map((line, i) => {
                // Divisor
                if (line === "---") {
                  return (
                    <li key={i} className="py-1">
                      <div className="w-full h-px bg-black/30" />
                    </li>
                  );
                }

                // ✅ SE FOR JSX (Objeto customizado), RENDERIZA DIRETO (Sem a bolinha)
                if (typeof line !== "string") {
                  return (
                    <li key={i} className="mt-1">
                      {line}
                    </li>
                  );
                }

                // Padrão antigo para textos normais (Com a bolinha)
                return (
                  <li
                    key={i}
                    className="text-sm text-foreground/90 dark:text-slate-300 flex items-start gap-2"
                  >
                    <span className={`${t.dot} font-medium`}>•</span>
                    <span className="break-words whitespace-pre-wrap">
                      {line}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          {cancelText && cancelText.trim() !== "" && (
            <button
              onClick={onCancel}
              disabled={loading}
              className="flex-1 py-3 rounded-xl border border-border text-muted-foreground/80 font-medium text-sm hover:bg-muted/50 dark:hover:bg-card/5 transition-colors disabled:opacity-60"
            >
              {cancelText}
            </button>
          )}
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-3 rounded-xl ${t.confirm} text-foreground dark:text-white font-medium text-sm shadow-lg ${t.ring} transition-all transform active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            {loading ? "Confirmando..." : confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
