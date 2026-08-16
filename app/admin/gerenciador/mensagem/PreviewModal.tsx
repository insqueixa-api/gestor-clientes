"use client";
// app/admin/gerenciador/mensagem/PreviewModal.tsx
// Extraído de page.tsx (15/08/2026) — modal de visualizar mensagem, carrega
// via next/dynamic só quando abre.
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { supabaseBrowser } from "@/lib/supabase/browser";
import type { MessageTemplate } from "./shared";

export default function PreviewModal({
  template,
  onClose,
  onEdit,
}: {
  template: MessageTemplate;
  onClose: () => void;
  onEdit: () => void;
}) {
  // ✅ NOVO: Estado para dar o feedback visual de "Copiado"
  const [copied, setCopied] = useState(false);

  // ✅ O envio automático sorteia entre este texto e as variações cadastradas
  // (evita padrão repetitivo). O botão que abre este modal é rotulado "Ver",
  // sugerindo "isto é o que será enviado" — sem esse aviso, o admin não tinha
  // como saber, só olhando aqui, que o texto real enviado pode ser diferente.
  const [variantCount, setVariantCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    supabaseBrowser
      .from("message_template_variants")
      .select("id", { count: "exact", head: true })
      .eq("template_id", template.id)
      .then(({ count }) => {
        if (!cancelled) setVariantCount(count ?? 0);
      });
    return () => {
      cancelled = true;
    };
  }, [template.id]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[78vh]">
        {/* Cabeçalho */}
        <div className="px-3 py-2.5 sm:px-4 sm:py-3 border-b border-border flex justify-between items-center bg-transparent shrink-0">
          <h3 className="font-medium text-foreground truncate pr-3 text-sm sm:text-base">
            {template.name}
          </h3>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Conteúdo da Mensagem */}
        <div className="flex-1 p-3 sm:p-4 overflow-y-auto custom-scrollbar bg-muted/20 border border-border">
          <div className="flex flex-col gap-3 whitespace-pre-wrap text-xs text-muted-foreground font-mono leading-relaxed bg-card p-2.5 sm:p-3 rounded-xl border border-border shadow-sm min-h-full">
            {/* ✅ PREVIEW DA IMAGEM SE HOUVER */}
            {template.image_url && (
              <div className="relative w-full max-w-sm mx-auto bg-transparent border border-border rounded-lg overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={template.image_url}
                  alt="Imagem da mensagem"
                  className="w-full h-auto object-cover"
                />
              </div>
            )}
            <div>{template.content}</div>
          </div>
          {variantCount > 0 && (
            <p className="text-[10px] text-muted-foreground/70 mt-2 px-0.5">
              ℹ️ Este modelo tem {variantCount} variação
              {variantCount > 1 ? "ões" : ""} de texto cadastrada
              {variantCount > 1 ? "s" : ""} — o envio automático sorteia entre
              este texto e as variações, então a mensagem enviada pode ser
              diferente da mostrada aqui.
            </p>
          )}
        </div>

        {/* Rodapé e Botões (AGORA COM O BOTÃO DE COPIAR) */}
        <div className="px-3 py-2.5 sm:px-4 sm:py-3 border-t border-border flex justify-end gap-1.5 bg-card shrink-0">
          {/* ✅ NOVO: BOTÃO DE COPIAR */}
          <button
            onClick={() => {
              navigator.clipboard.writeText(template.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000); // Volta ao normal após 2 segundos
            }}
            className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg border font-medium text-[11px] transition-colors uppercase flex items-center justify-center gap-1.5 ${
              copied
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                : "border-border text-foreground/90 hover:bg-muted"
            }`}
          >
            {copied ? (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                Copiado!
              </>
            ) : (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                Copiar
              </>
            )}
          </button>

          <button
            onClick={onClose}
            className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg border border-border text-muted-foreground font-medium text-[11px] hover:bg-muted transition-colors uppercase"
          >
            Fechar
          </button>

          <button
            onClick={onEdit}
            className="flex-1 sm:flex-none px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium text-[11px] shadow-lg shadow-amber-900/20 transition-transform active:scale-95 uppercase flex items-center justify-center gap-1.5"
          >
            ✏️ Editar Modelo
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
