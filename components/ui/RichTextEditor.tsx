"use client";
// components/ui/RichTextEditor.tsx
//
// Editor de texto rico (TipTap) — 30/09/2026, pedido do Márcio: negrito,
// itálico, marcadores… no Condomínio (texto da Ação, introdução da Edição)
// e depois nos Detalhes dos apps. Mensagem de WhatsApp NÃO usa este
// (usa components/whatsapp/WhatsAppTextarea.tsx, que gera *símbolos*).
//
// Salva HTML simples na mesma coluna de texto de sempre; texto antigo
// (puro) abre convertido em parágrafos. Mostrar SEMPRE via
// renderRichText() (lib/rich-text/sanitize.ts) + RICH_TEXT_CLASSES.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  isRichTextEmpty,
  plainTextToEditorHtml,
} from "@/lib/rich-text/sanitize";

// Estilo do conteúdo rico — o mesmo no editor e onde o texto é mostrado
// (grade de Ações, prévia da Edição), pra o que aparece ser o que salva.
export const RICH_TEXT_CLASSES =
  "[&_p]:my-0.5 [&_p:empty]:min-h-[1em] [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1 [&_li]:my-0 [&_li_p]:my-0 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_a]:underline [&_a]:text-sky-600 dark:[&_a]:text-sky-400 [&_strong]:font-semibold";

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeightClass?: string;
  disabled?: boolean;
};

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeightClass = "min-h-[140px]",
  disabled = false,
}: Props) {
  // Último HTML que o próprio editor emitiu — evita reescrever o conteúdo
  // (e perder o cursor) quando o `value` que volta é o mesmo que acabou de
  // sair daqui.
  const lastEmitted = useRef<string>(value);
  // onChange sempre o mais recente — o useEditor só lê as opções na criação.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["http", "https", "mailto", "tel"],
        },
      }),
    ],
    content: plainTextToEditorHtml(value),
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: `outline-none px-3 py-2 text-sm text-foreground ${minHeightClass} ${RICH_TEXT_CLASSES}`,
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      const out = isRichTextEmpty(html) ? "" : html;
      lastEmitted.current = out;
      onChangeRef.current(out);
    },
  });

  // `value` mudou por fora (carregou do banco, aceitou sugestão da IA…)
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(plainTextToEditorHtml(value), { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const state = useEditorState({
    editor,
    selector: ({ editor: ed }) =>
      ed
        ? {
            bold: ed.isActive("bold"),
            italic: ed.isActive("italic"),
            underline: ed.isActive("underline"),
            strike: ed.isActive("strike"),
            bullet: ed.isActive("bulletList"),
            ordered: ed.isActive("orderedList"),
            quote: ed.isActive("blockquote"),
            link: ed.isActive("link"),
            empty: ed.isEmpty,
          }
        : null,
  });

  function setLink() {
    if (!editor) return;
    const current = (editor.getAttributes("link").href as string | undefined) || "";
    const url = window.prompt("Endereço do link (deixe vazio pra remover):", current || "https://");
    if (url === null) return;
    const clean = url.trim();
    if (!clean || clean === "https://") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: clean }).run();
  }

  const btn = (
    active: boolean | undefined,
    title: string,
    onClick: () => void,
    label: ReactNode,
  ) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={!!active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled || !editor}
      className={`h-7 min-w-7 px-1.5 rounded-md text-xs transition-colors border ${
        active
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
          : "text-muted-foreground hover:text-foreground hover:bg-muted border-transparent"
      } disabled:opacity-40`}
    >
      {label}
    </button>
  );

  const chain = () => editor?.chain().focus();

  return (
    <div
      className={`rounded-lg border border-border bg-transparent focus-within:border-emerald-500 transition-colors ${
        disabled ? "opacity-70" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1" role="toolbar" aria-label="Formatação">
        {btn(state?.bold, "Negrito (Ctrl+B)", () => chain()?.toggleBold().run(), <b>B</b>)}
        {btn(state?.italic, "Itálico (Ctrl+I)", () => chain()?.toggleItalic().run(), <i>I</i>)}
        {btn(state?.underline, "Sublinhado (Ctrl+U)", () => chain()?.toggleUnderline().run(), <u>U</u>)}
        {btn(state?.strike, "Tachado", () => chain()?.toggleStrike().run(), <s>S</s>)}
        <span className="mx-1 h-4 w-px bg-border" />
        {btn(state?.bullet, "Lista com marcadores", () => chain()?.toggleBulletList().run(), "•")}
        {btn(state?.ordered, "Lista numerada", () => chain()?.toggleOrderedList().run(), "1.")}
        {btn(state?.quote, "Citação", () => chain()?.toggleBlockquote().run(), "❝")}
        {btn(state?.link, "Link", setLink, "🔗")}
        <span className="mx-1 h-4 w-px bg-border" />
        {btn(false, "Limpar formatação", () => chain()?.unsetAllMarks().clearNodes().run(), "⌫")}
      </div>
      <div className="relative">
        {placeholder && (state?.empty ?? !value) && (
          <p className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground/70">
            {placeholder}
          </p>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
