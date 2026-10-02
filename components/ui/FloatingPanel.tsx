"use client";
// components/ui/FloatingPanel.tsx
//
// Painel de dropdown que "flutua" por cima de tudo (portal no body, position
// fixed). ✅ 02/10/2026 (Márcio): dropdowns dentro do <Modal> abriam presos
// na área de rolagem do corpo — ficavam escondidos atrás do rodapé e só
// apareciam rolando. Aqui o painel se posiciona pelo botão (anchorRef):
// abre pra BAIXO se couber, senão pra CIMA (o lado com mais espaço), e a
// altura máxima se ajusta ao espaço da tela. Acompanha scroll/resize.
//
// Clique-fora fica com quem usa (como antes): passe `dataAttr` igual ao do
// wrapper do botão, que o `closest("[data-...]")` continua achando o painel.
// Os eventos React do painel continuam subindo pela árvore do componente
// (portal), então clicar nele não fecha o <Modal>.
import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Pos = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

export default function FloatingPanel({
  anchorRef,
  open,
  children,
  preferredHeight = 360,
  minWidth = 0,
  align = "left",
  dataAttr,
  className = "",
  zClass = "z-[99995]",
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  children: ReactNode;
  /** altura desejada (px) — vira o teto se a tela tiver espaço */
  preferredHeight?: number;
  /** largura mínima (px); padrão = largura do botão */
  minWidth?: number;
  /** quando o painel é mais largo que o botão: alinha pela esquerda ou direita dele */
  align?: "left" | "right";
  dataAttr?: string;
  className?: string;
  /** camada (acima do modal que abriu o painel; padrão cobre o <Modal> comum) */
  zClass?: string;
}) {
  const [pos, setPos] = useState<Pos | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const GAP = 4;
    const MARGIN = 8;
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(Math.max(r.width, minWidth), vw - MARGIN * 2);
      let left = align === "right" ? r.right - width : r.left;
      left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN));
      const below = vh - r.bottom - GAP - MARGIN;
      const above = r.top - GAP - MARGIN;
      const openDown = below >= Math.min(preferredHeight, 240) || below >= above;
      const maxHeight = Math.max(120, Math.min(preferredHeight, openDown ? below : above));
      setPos(
        openDown
          ? { left, width, top: r.bottom + GAP, maxHeight }
          : { left, width, bottom: vh - r.top + GAP, maxHeight },
      );
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef, preferredHeight, minWidth, align]);

  if (!open || !pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      {...(dataAttr ? { [dataAttr]: "" } : {})}
      style={{ position: "fixed", left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
      className={`${zClass} flex flex-col rounded-lg border border-border bg-card shadow-xl overflow-hidden ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
