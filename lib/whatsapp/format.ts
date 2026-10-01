// lib/whatsapp/format.ts
//
// Formatação do WhatsApp aplicada a uma seleção de texto (barra de
// formatação do WhatsAppTextarea, 30/09/2026, pedido do Márcio: "selecionei
// o texto e apertei negrito, coloca o asterisco na frente e no final").
//
// Regras do próprio WhatsApp que valem aqui:
// - o símbolo tem que encostar no texto: "*texto*" formata, "* texto *" não
//   → espaços da ponta da seleção ficam FORA dos símbolos;
// - negrito/itálico/tachado não atravessam quebra de linha → com várias
//   linhas selecionadas, cada linha ganha os próprios símbolos;
// - WhatsApp NÃO tem sublinhado (não existe símbolo pra isso).
//
// Funções puras: recebem o texto + seleção e devolvem qual trecho trocar e
// por quê — quem chama aplica (via execCommand, pra manter o Ctrl+Z).

export type WaWrapStyle = "bold" | "italic" | "strike" | "mono";
export type WaLineStyle = "bullet" | "numbered" | "quote";

export const WA_WRAP_MARKERS: Record<WaWrapStyle, string> = {
  bold: "*",
  italic: "_",
  strike: "~",
  mono: "```",
};

const WA_LINE_PREFIX: Record<Exclude<WaLineStyle, "numbered">, string> = {
  bullet: "- ",
  quote: "> ",
};

export type WaEdit = {
  /** trecho do texto original a ser substituído */
  from: number;
  to: number;
  insert: string;
  /** seleção depois da troca (posições no texto novo) */
  selStart: number;
  selEnd: number;
};

function wrapLine(line: string, m: string): string {
  const lead = line.match(/^\s*/)?.[0] ?? "";
  const trail = line.match(/\s*$/)?.[0] ?? "";
  const core = line.slice(lead.length, line.length - trail.length);
  if (!core) return line;
  return `${lead}${m}${core}${m}${trail}`;
}

export function applyWaWrap(
  text: string,
  start: number,
  end: number,
  style: WaWrapStyle,
): WaEdit {
  const m = WA_WRAP_MARKERS[style];
  const len = m.length;

  // Sem seleção: insere o par e deixa o cursor no meio
  if (start === end) {
    return { from: start, to: end, insert: m + m, selStart: start + len, selEnd: start + len };
  }

  const selected = text.slice(start, end);

  // Desfazer 1: símbolos logo fora da seleção ("*|texto|*")
  if (
    start >= len &&
    text.slice(start - len, start) === m &&
    text.slice(end, end + len) === m
  ) {
    return {
      from: start - len,
      to: end + len,
      insert: selected,
      selStart: start - len,
      selEnd: end - len,
    };
  }

  // Desfazer 2: a própria seleção já vem com os símbolos ("|*texto*|")
  if (selected.length > len * 2 && selected.startsWith(m) && selected.endsWith(m)) {
    const inner = selected.slice(len, selected.length - len);
    return { from: start, to: end, insert: inner, selStart: start, selEnd: start + inner.length };
  }

  // Monoespaçado em bloco pode atravessar linhas; os outros vão linha a linha
  const wrapped =
    style === "mono"
      ? wrapLine(selected, m)
      : selected.split("\n").map((l) => wrapLine(l, m)).join("\n");

  return { from: start, to: end, insert: wrapped, selStart: start, selEnd: start + wrapped.length };
}

export function applyWaLinePrefix(
  text: string,
  start: number,
  end: number,
  style: WaLineStyle,
): WaEdit {
  // Expande pra linhas inteiras
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
  if (lineEnd === -1) lineEnd = text.length;

  const block = text.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const filled = lines.filter((l) => l.trim() !== "");

  const hasPrefix = (l: string) =>
    style === "numbered" ? /^\d+\.\s/.test(l) : l.startsWith(WA_LINE_PREFIX[style]);
  const stripPrefix = (l: string) =>
    style === "numbered" ? l.replace(/^\d+\.\s/, "") : l.slice(WA_LINE_PREFIX[style].length);

  const allHave = filled.length > 0 && filled.every(hasPrefix);

  let n = 0;
  const out = lines
    .map((l) => {
      if (l.trim() === "") return l;
      if (allHave) return stripPrefix(l);
      const base = hasPrefix(l) ? stripPrefix(l) : l;
      n++;
      return style === "numbered" ? `${n}. ${base}` : `${WA_LINE_PREFIX[style]}${base}`;
    })
    .join("\n");

  return {
    from: lineStart,
    to: lineEnd,
    insert: out,
    selStart: lineStart,
    selEnd: lineStart + out.length,
  };
}
