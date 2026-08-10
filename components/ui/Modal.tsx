"use client";
// components/ui/Modal.tsx
//
// Casca padrão de modal do sistema — espelha fielmente o modal de "Renovação
// de Assinatura" (app/admin/cliente/recarga_cliente.tsx), apontado pelo
// Márcio como referência (10/08/2026): mesma largura, altura, cantos,
// centralização, trava de scroll da página de fundo e fechamento por clique
// no fundo. Sem isso, cada tela reinventava a própria modal com valores
// ligeiramente diferentes (max-w, max-h, rounded-xl vs rounded-2xl, z-index,
// grid vs flex pra centralizar) — ver auditoria de 10/08/2026.
//
// Uso:
//   <Modal onClose={onClose}>
//     <ModalHeader onClose={onClose}>...título/ícone...</ModalHeader>
//     <ModalBody>...conteúdo rolável...</ModalBody>
//     <ModalFooter>...botões...</ModalFooter>
//   </Modal>
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function Modal({
  onClose,
  children,
  maxWidth = "max-w-3xl",
  zIndex = "z-[99990]",
}: {
  onClose: () => void;
  children: ReactNode;
  // Largura é o único eixo que ainda varia por conteúdo (ex: tabela larga) —
  // altura/comportamento ficam sempre iguais.
  maxWidth?: string;
  zIndex?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const scrollYRef = useRef(0);

  // Trava o scroll da página de fundo enquanto a modal está aberta (mesma
  // receita do recarga_cliente.tsx — segura em iOS) e só monta o portal
  // depois do 1º render pra nunca dar flash de hidratação.
  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined") return;

    const body = document.body;
    const html = document.documentElement;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    scrollYRef.current = scrollY;

    const prevBodyOverflow = body.style.overflow;
    const prevBodyPosition = body.style.position;
    const prevBodyTop = body.style.top;
    const prevBodyWidth = body.style.width;
    const prevHtmlOverflow = html.style.overflow;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      body.style.position = prevBodyPosition;
      body.style.top = prevBodyTop;
      body.style.width = prevBodyWidth;
      window.scrollTo(0, scrollYRef.current || 0);
    };
  }, []);

  // Segurança de teclado mobile (mesmo recurso já validado em
  // novo_cliente.tsx, único lugar do sistema que tinha isso até agora): ao
  // abrir o teclado, o campo focado pode ficar escondido atrás dele — isso
  // reencaixa ele na área visível. Sem isso é o bug que o Márcio reportou no
  // FloatingChat (campo de mensagem some atrás do teclado).
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const handleViewportResize = () => {
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
      ) {
        setTimeout(
          () => el.scrollIntoView({ behavior: "smooth", block: "center" }),
          80,
        );
      }
    };
    window.visualViewport.addEventListener("resize", handleViewportResize);
    return () =>
      window.visualViewport?.removeEventListener(
        "resize",
        handleViewportResize,
      );
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndex} flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200 overflow-hidden overscroll-contain`}
      onPointerDown={(e) => {
        // Só fecha se o clique começar exatamente no fundo escuro.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full ${maxWidth} bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden min-h-0 max-h-[90vh] transition-all animate-in fade-in zoom-in-95 duration-200`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalHeader({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="px-6 py-4 border-b border-border flex justify-between items-center bg-transparent rounded-t-xl shrink-0">
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button
          onClick={onClose}
          type="button"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

export function ModalBody({
  children,
  // Espaçamento tem um padrão (igual à referência), mas é substituído por
  // inteiro quando informado — nunca concatenado. Sem tailwind-merge no
  // projeto, `"p-3 sm:p-4 ... " + "p-6"` gera duas classes de padding
  // conflitantes na mesma tag, e qual delas "ganha" depende só da ordem no
  // CSS compilado, não da ordem no className — resultado imprevisível.
  className = "p-3 sm:p-4 space-y-3 sm:space-y-4",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-y-auto overscroll-contain custom-scrollbar flex-1 min-h-0 ${className}`}
    >
      {children}
    </div>
  );
}

export function ModalFooter({
  children,
  // Mesmo padrão do ModalBody: informado, substitui o layout padrão
  // (linha única de botões à direita) por inteiro — útil quando o rodapé
  // também tem um aviso empilhado em cima dos botões.
  className = "flex justify-end gap-3",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-border bg-transparent sm:rounded-b-xl shrink-0 ${className}`}
    >
      {children}
    </div>
  );
}
