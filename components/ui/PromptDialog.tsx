"use client";
// components/ui/PromptDialog.tsx

import React, { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";

type Tone = "emerald" | "rose" | "amber" | "sky" | "slate";

function toneClasses(tone: Tone) {
  switch (tone) {
    case "rose":
      return {
        ring: "shadow-rose-500/30",
        iconBg: "bg-rose-500/10",
        confirm: "bg-rose-600 hover:bg-rose-500",
        focus: "focus:border-rose-500 focus:ring-rose-500/30",
      };
    case "amber":
      return {
        ring: "shadow-amber-500/30",
        iconBg: "bg-amber-500/10",
        confirm: "bg-amber-600 hover:bg-amber-500",
        focus: "focus:border-amber-500 focus:ring-amber-500/30",
      };
    case "sky":
      return {
        ring: "shadow-sky-500/30",
        iconBg: "bg-sky-500/10",
        confirm: "bg-sky-600 hover:bg-sky-500",
        focus: "focus:border-sky-500 focus:ring-sky-500/30",
      };
    case "slate":
      return {
        ring: "shadow-slate-500/20",
        iconBg: "bg-muted",
        confirm: "bg-foreground text-background hover:bg-foreground/90",
        focus: "focus:border-foreground/40 focus:ring-foreground/20",
      };
    default:
      return {
        ring: "shadow-emerald-500/30",
        iconBg: "bg-emerald-500/10",
        confirm: "bg-emerald-600 hover:bg-emerald-500",
        focus: "focus:border-emerald-500 focus:ring-emerald-500/30",
      };
  }
}

export type PromptDialogProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  tone?: Tone;
  icon?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  loading?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
};

export default function PromptDialog({
  open,
  title,
  subtitle = "Preencha o campo abaixo.",
  label,
  placeholder,
  defaultValue = "",
  tone = "emerald",
  icon,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  loading = false,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, defaultValue]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const t = toneClasses(tone);

  return (
    <Modal onClose={onCancel} maxWidth="max-w-sm" zIndex="z-[100000]">
      <div className="p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-12 h-12 rounded-full ${t.iconBg} flex items-center justify-center text-2xl`}
          >
            {icon ?? "✏️"}
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-foreground truncate">
              {title}
            </h3>
            <p className="text-xs text-foreground/70">{subtitle}</p>
          </div>
        </div>

        <div>
          {label && (
            <label className="block text-xs font-medium text-foreground/70 mb-1.5">
              {label}
            </label>
          )}
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) onConfirm(value);
            }}
            placeholder={placeholder}
            disabled={loading}
            className={`w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:ring-2 ${t.focus} disabled:opacity-60`}
          />
        </div>

        <div className="flex gap-3 pt-2">
          {cancelText && cancelText.trim() !== "" && (
            <button
              onClick={onCancel}
              disabled={loading}
              className="flex-1 py-3 rounded-xl border border-border text-muted-foreground font-medium text-sm hover:bg-muted transition-colors disabled:opacity-60"
            >
              {cancelText}
            </button>
          )}
          <button
            onClick={() => onConfirm(value)}
            disabled={loading}
            className={`flex-1 py-3 rounded-xl ${t.confirm} text-white font-medium text-sm shadow-lg ${t.ring} transition-all transform active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            {loading ? "Confirmando..." : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
