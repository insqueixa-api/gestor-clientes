"use client";
// components/ui/Dropdown.tsx
//
// Painel flutuante (menu/dropdown) que escapa de QUALQUER ancestral com
// overflow (tabela com scroll horizontal, corpo de modal, aba com
// overflow-hidden, etc.) — usa `position: fixed` com coordenadas calculadas
// a partir do botão que abriu, renderizado via portal em document.body.
//
// Achado em 10/08/2026: vários menus do sistema usavam `position: absolute`
// dentro de containers com `overflow-x-auto` (ex: barra de ações em massa
// da Agenda, dropdown de WhatsApp por linha em várias tabelas) — como
// `overflow-x-auto` força `overflow-y` a virar `auto` também (regra do CSS),
// o menu ficava cortado pela caixa do ancestral, mostrando um scroll
// espremido no lugar de um menu flutuante de verdade. Mesma raiz do
// `DropdownPortal` local de app/admin/AdminShell.tsx — generalizado aqui
// pra qualquer outro menu do sistema reaproveitar em vez de reinventar.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

export function Dropdown({
  open,
  onClose,
  triggerRef,
  children,
  align = "right",
  placement = "below",
  width = "w-64",
  matchTriggerWidth = false,
  panelBg = "bg-card",
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  // Ref do elemento (botão ou wrapper) que abre o menu — usado tanto pra
  // calcular a posição quanto pra ignorar cliques nele no listener de
  // fechar-ao-clicar-fora (senão o próprio clique de abrir já fecharia).
  triggerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  // "right": alinha a borda direita do painel com a borda direita do
  // trigger (padrão, mesmo comportamento de antes). "left": alinha pela
  // esquerda — pra menus perto da borda esquerda da tela.
  align?: "left" | "right";
  // "below" (padrão): abre pra baixo, colado no fundo do trigger. "above":
  // abre pra cima — pra gatilhos perto do fim de uma área rolável, onde não
  // sobra espaço embaixo.
  placement?: "below" | "above";
  width?: string;
  // Quando true, ignora `width` e usa a largura real do trigger (em px) —
  // pra dropdowns tipo autocomplete que devem ficar do mesmo tamanho do
  // campo de busca que os abriu.
  matchTriggerWidth?: boolean;
  // Prop separada de `className` de propósito — um dropdown quase nunca
  // precisa mudar o fundo, mas quando precisa (ex: um com backdrop-blur em
  // vez de sólido), colocar em `className` criaria duas classes `bg-*`
  // brigando pela mesma propriedade CSS, com resultado imprevisível (mesma
  // razão do ModalBody/ModalFooter em components/ui/Modal.tsx).
  panelBg?: string;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
    width?: number;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open) return;
    function updatePos() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos({
        ...(placement === "below"
          ? { top: r.bottom + 8 }
          : { bottom: window.innerHeight - r.top + 8 }),
        ...(align === "right"
          ? { right: window.innerWidth - r.right }
          : { left: r.left }),
        ...(matchTriggerWidth ? { width: r.width } : {}),
      });
    }
    updatePos();
    // Reposiciona (não fecha) em resize/scroll — inclusive scroll dentro de
    // um ancestral com overflow (ex: rolar a tabela), capturado com `true`.
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [open, align, placement, matchTriggerWidth, triggerRef]);

  useEffect(() => {
    if (!open) return;
    function handleOutsideMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", handleOutsideMouseDown);
    return () =>
      document.removeEventListener("mousedown", handleOutsideMouseDown);
  }, [open, onClose, triggerRef]);

  if (!mounted || !open || !pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        top: pos.top,
        bottom: pos.bottom,
        left: pos.left,
        right: pos.right,
        width: pos.width,
      }}
      className={`fixed z-[9999] ${matchTriggerWidth ? "" : width} rounded-xl border border-border ${panelBg} shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
