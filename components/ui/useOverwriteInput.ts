"use client";
// components/ui/useOverwriteInput.ts
// Liga o motor de components/ui/overwriteMask.ts num <input type="text">:
// teclado (dígito/Backspace/Delete/setas), colar e o onChange de teclados
// de celular que não mandam a tecla no keydown. Cursor/seleção aplicados
// depois do render (useLayoutEffect), sem pular pro fim.
import { useLayoutEffect, useRef } from "react";
import { backspace, del, fromLooseText, stepSegment, typeDigit, type MaskState } from "./overwriteMask";

export function useOverwriteInput(opts: {
  template: string;
  text: string;
  setText: (text: string) => void;
  /** Só pra data/data-hora: setas ↑/↓ mudam o segmento do cursor. */
  allowStep?: boolean;
}) {
  const { template, text, setText, allowStep } = opts;
  const ref = useRef<HTMLInputElement | null>(null);
  const pendingSel = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const sel = pendingSel.current;
    if (sel && ref.current && document.activeElement === ref.current) {
      ref.current.setSelectionRange(sel.start, sel.end);
    }
    pendingSel.current = null;
  });

  const apply = (s: MaskState) => {
    pendingSel.current = { start: s.caret, end: s.selEnd ?? s.caret };
    if (s.text !== text) setText(s.text);
    else if (ref.current) ref.current.setSelectionRange(s.caret, s.selEnd ?? s.caret);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // Ctrl+A/C/V/Z seguem o normal
    const el = e.currentTarget;
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? start;
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      apply(typeDigit(template, text, start, end, e.key));
    } else if (e.key === "Backspace") {
      e.preventDefault();
      apply(backspace(template, text, start, end));
    } else if (e.key === "Delete") {
      e.preventDefault();
      if (start === 0 && end >= text.length) apply({ text: "", caret: 0 });
      else apply(del(template, text, start));
    } else if (allowStep && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const next = stepSegment(template, text, start, e.key === "ArrowUp" ? 1 : -1);
      if (next) apply({ text: next, caret: start, selEnd: end });
    } else if (e.key.length === 1) {
      // letras/símbolos nunca entram (as barras são fixas)
      e.preventDefault();
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const t = fromLooseText(template, e.clipboardData.getData("text"));
    if (t) apply({ text: t, caret: t.length });
  };

  // Celular (tecla "Unidentified") / autocompletar: chega só o texto novo.
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const t = fromLooseText(template, raw);
    apply({ text: t, caret: t.length });
  };

  return { ref, onKeyDown, onPaste, onChange };
}
