// lib/rich-text/sanitize.ts
//
// Texto rico do Condomínio (texto da Ação, introdução da Edição) — e depois
// Detalhes dos apps (docs/apps-refactor/PLANO.md, fase 8). Criado
// 30/09/2026.
//
// O editor (components/ui/RichTextEditor.tsx, TipTap) salva HTML simples na
// MESMA coluna de texto de sempre. Textos antigos (texto puro, sem tag)
// continuam valendo: `renderRichText` detecta e trata como texto puro
// (escapa + quebra de linha), igual era antes.
//
// Segurança: SEMPRE passar por aqui antes de mostrar (app e PDF). Allowlist
// de tags, nenhum atributo exceto href em <a> (só http/https/mailto/tel),
// script/style/iframe removidos com conteúdo. Sem DOM (roda no servidor, no
// navegador e no Cloudflare Worker do PDF).
//
// ⚠️ Cópia em JS puro no Worker do PDF:
// C:\Users\Marcio\Gestor de Clientes\unigestor-pdf-worker\src\richText.js
// — mudou aqui, muda lá (e publica o Worker).

const ALLOWED = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "a", "blockquote",
]);
const VOID = new Set(["br"]);

const RICH_TAG_RE = /<(p|br|strong|b|em|i|u|s|ul|ol|li|a|blockquote)\b[^>]*>/i;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Texto salvo pelo editor novo (tem tag conhecida) vs texto puro antigo. */
export function isRichHtml(s: string | null | undefined): boolean {
  return !!s && RICH_TAG_RE.test(s);
}

function safeHref(attrs: string): string | null {
  const m = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const raw = (m?.[2] ?? m?.[3] ?? m?.[4] ?? "").trim();
  if (!raw) return null;
  const decoded = raw.replace(/&amp;/g, "&");
  if (!/^(https?:|mailto:|tel:)/i.test(decoded)) return null;
  return escapeHtml(decoded);
}

export function sanitizeRichHtml(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed|noscript|template)\b[^>]*\/?>/gi, "");

  let out = "";
  let last = 0;
  const open: string[] = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(s))) {
    // texto entre tags: "<"/">" soltos viram entidade
    out += s.slice(last, m.index).replace(/</g, "&lt;").replace(/>/g, "&gt;");
    last = tagRe.lastIndex;

    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (!ALLOWED.has(tag)) continue; // tag desconhecida some, conteúdo fica

    if (VOID.has(tag)) {
      if (!closing) out += "<br>";
      continue;
    }
    if (closing) {
      const idx = open.lastIndexOf(tag);
      if (idx === -1) continue; // fechamento sem abertura
      while (open.length > idx) out += `</${open.pop()}>`;
      continue;
    }
    if (tag === "a") {
      const href = safeHref(m[3]);
      out += href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">` : "<a>";
    } else {
      out += `<${tag}>`;
    }
    open.push(tag);
  }
  out += s.slice(last).replace(/</g, "&lt;").replace(/>/g, "&gt;");
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

/** HTML pronto pra mostrar: rico → sanitizado; texto puro antigo → escapado com <br>. */
export function renderRichText(s: string | null | undefined): string {
  if (!s) return "";
  if (isRichHtml(s)) return sanitizeRichHtml(s);
  return escapeHtml(s).replace(/\r?\n/g, "<br>");
}

/** Texto puro antigo → HTML de parágrafos, pro editor abrir com o texto. */
export function plainTextToEditorHtml(s: string | null | undefined): string {
  if (!s) return "";
  if (isRichHtml(s)) return sanitizeRichHtml(s);
  return s
    .split(/\r?\n/)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

/** Só o texto (busca, IA, contagem) — tira as tags. */
export function richTextToPlain(s: string | null | undefined): string {
  if (!s) return "";
  if (!isRichHtml(s)) return s;
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Editor vazio devolve "<p></p>" — trata como vazio. */
export function isRichTextEmpty(s: string | null | undefined): boolean {
  return richTextToPlain(s).trim() === "";
}
