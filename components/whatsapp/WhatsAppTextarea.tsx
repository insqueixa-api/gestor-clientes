"use client";
// components/whatsapp/WhatsAppTextarea.tsx
//
// Textarea de mensagem do WhatsApp com barra de formatação (30/09/2026,
// pedido do Márcio). Drop-in: aceita as MESMAS props de <textarea> (value,
// onChange com evento, rows, className, placeholder, disabled...) — pra
// usar é só trocar o nome da tag. `className` continua indo pro textarea;
// `wrapperClassName` vai pro bloco barra+textarea.
//
// A barra insere via document.execCommand("insertText"): o navegador trata
// como digitação normal → o onChange do React dispara igual, e Ctrl+Z
// desfaz a formatação. Regras de formatação em lib/whatsapp/format.ts.
import { useRef } from "react";
import type { KeyboardEvent, ReactNode, Ref, TextareaHTMLAttributes } from "react";
import {
  applyWaLinePrefix,
  applyWaWrap,
  type WaEdit,
  type WaLineStyle,
  type WaWrapStyle,
} from "@/lib/whatsapp/format";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  wrapperClassName?: string;
  // React 19: ref chega como prop normal — repassada junto com a interna
  // (ex: EditorModal usa pra inserir {variáveis} na posição do cursor).
  ref?: Ref<HTMLTextAreaElement>;
};

type ToolButton =
  | { kind: "wrap"; style: WaWrapStyle; label: ReactNode; title: string }
  | { kind: "line"; style: WaLineStyle; label: ReactNode; title: string };

const TOOLS: ToolButton[] = [
  { kind: "wrap", style: "bold", label: <b>B</b>, title: "Negrito — *texto* (Ctrl+B)" },
  { kind: "wrap", style: "italic", label: <i>I</i>, title: "Itálico — _texto_ (Ctrl+I)" },
  { kind: "wrap", style: "strike", label: <s>S</s>, title: "Tachado — ~texto~" },
  { kind: "wrap", style: "mono", label: <span className="font-mono">{"</>"}</span>, title: "Monoespaçado — ```texto```" },
  { kind: "line", style: "bullet", label: "•", title: "Lista com marcadores — - item" },
  { kind: "line", style: "numbered", label: "1.", title: "Lista numerada — 1. item" },
  { kind: "line", style: "quote", label: "❝", title: "Citação — > texto" },
];

function applyEdit(el: HTMLTextAreaElement, edit: WaEdit) {
  el.focus();
  el.setSelectionRange(edit.from, edit.to);
  // execCommand ainda é o único jeito de inserir mantendo o Ctrl+Z do
  // navegador; se não existir/falhar, cai pro setter nativo + evento input
  // (o React escuta esse evento e chama o onChange do mesmo jeito).
  const ok =
    typeof document.execCommand === "function" &&
    document.execCommand("insertText", false, edit.insert);
  if (!ok) {
    const next = el.value.slice(0, edit.from) + edit.insert + el.value.slice(edit.to);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.setSelectionRange(edit.selStart, edit.selEnd);
}

export default function WhatsAppTextarea({
  wrapperClassName = "",
  onKeyDown,
  disabled,
  readOnly,
  ref: externalRef,
  ...rest
}: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const setRefs = (el: HTMLTextAreaElement | null) => {
    ref.current = el;
    if (typeof externalRef === "function") externalRef(el);
    else if (externalRef) (externalRef as { current: HTMLTextAreaElement | null }).current = el;
  };
  const locked = !!disabled || !!readOnly;

  function run(tool: ToolButton) {
    const el = ref.current;
    if (!el || locked) return;
    const { value, selectionStart: s, selectionEnd: e } = el;
    const edit =
      tool.kind === "wrap"
        ? applyWaWrap(value, s, e, tool.style)
        : applyWaLinePrefix(value, s, e, tool.style);
    applyEdit(el, edit);
  }

  function handleKeyDown(ev: KeyboardEvent<HTMLTextAreaElement>) {
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey) {
      const k = ev.key.toLowerCase();
      if (k === "b" || k === "i") {
        ev.preventDefault();
        run(TOOLS[k === "b" ? 0 : 1]);
        return;
      }
    }
    onKeyDown?.(ev);
  }

  return (
    <div className={`flex flex-col gap-1 ${wrapperClassName}`}>
      <div
        className={`flex flex-wrap items-center gap-0.5 ${locked ? "opacity-40 pointer-events-none" : ""}`}
        role="toolbar"
        aria-label="Formatação do WhatsApp"
      >
        {TOOLS.map((tool) => (
          <button
            key={tool.style}
            type="button"
            title={tool.title}
            aria-label={tool.title}
            tabIndex={-1}
            // mousedown + preventDefault: não tira o foco/seleção do textarea
            onMouseDown={(ev) => {
              ev.preventDefault();
              run(tool);
            }}
            className="h-7 min-w-7 px-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent hover:border-border transition-colors"
          >
            {tool.label}
          </button>
        ))}
      </div>
      <textarea
        ref={setRefs}
        disabled={disabled}
        readOnly={readOnly}
        onKeyDown={handleKeyDown}
        {...rest}
      />
    </div>
  );
}
