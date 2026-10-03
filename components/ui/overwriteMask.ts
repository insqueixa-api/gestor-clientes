// components/ui/overwriteMask.ts
//
// ✅ 03/10/2026, pedido do Márcio: motor de máscara "sobrescreve no lugar"
// pros campos de data/hora (FormattedDateInput / FormattedTimeInput).
//
// Antes a máscara juntava todos os dígitos e reformatava do zero a cada
// tecla: selecionar o "02" de 02/10/2026 e digitar fazia tudo deslizar
// (vira 10/20/2608) e o cursor pulava pro fim. Agora cada dígito ocupa uma
// posição fixa do molde (DD/MM/AAAA, HH:MM...): digitar troca SÓ o dígito
// da posição, o cursor anda pro próximo, as barras nunca mudam de lugar.
//
// Funções puras (sem React) — testadas em overwriteMask.test.ts.

/** Letras do molde = posição de dígito; qualquer outro char = separador fixo. */
export const DATE_TEMPLATE = "DD/MM/AAAA";
export const DATETIME_TEMPLATE = "DD/MM/AAAA HH:MM";
export const TIME_TEMPLATE = "HH:MM";

export type MaskState = { text: string; caret: number; selEnd?: number };

const isSlot = (template: string, i: number) => /[A-Za-z]/.test(template[i] ?? "");

function nextSlot(template: string, from: number): number {
  for (let i = from; i < template.length; i++) if (isSlot(template, i)) return i;
  return -1;
}

function prevSlot(template: string, from: number): number {
  for (let i = from; i >= 0; i--) if (isSlot(template, i)) return i;
  return -1;
}

/** Primeiro dígito acima disso num segmento = completa com 0 e pula (ex: dia "5" → "05"). */
function segmentFirstDigitMax(template: string, pos: number): number | null {
  const letter = template[pos];
  const isSegmentStart = pos === 0 || template[pos - 1] !== letter;
  if (!isSegmentStart || template[pos + 1] !== letter) return null;
  if (letter === "D") return 3;
  if (letter === "M" && template[pos + 2] !== "M") return 1; // MM (mês); "MM" de minuto também usa M → ver abaixo
  if (letter === "H") return 2;
  return null;
}

/** Minutos no molde de hora usam "MM" depois de "HH:" — distingue de mês. */
function isMinuteSegment(template: string, pos: number) {
  return template[pos] === "M" && template.slice(Math.max(0, pos - 3), pos) === "HH:";
}

function appendSeparators(template: string, arr: string[]) {
  while (arr.length < template.length && !isSlot(template, arr.length)) arr.push(template[arr.length]);
}

/** Digita um dígito com a seleção [selStart, selEnd]. */
export function typeDigit(template: string, text: string, selStart: number, selEnd: number, digit: string): MaskState {
  let arr = text.split("");
  // tudo selecionado (Ctrl+A) → começa do zero
  if (selStart === 0 && selEnd >= arr.length && arr.length > 0) {
    arr = [];
    selStart = 0;
  }
  const start = Math.min(selStart, arr.length);
  const pos = nextSlot(template, start);
  if (pos < 0) return { text, caret: selStart };
  while (arr.length < pos) arr.push(isSlot(template, arr.length) ? "0" : template[arr.length]);

  const max = isMinuteSegment(template, pos) ? 5 : segmentFirstDigitMax(template, pos);
  let caretAfter: number;
  if (max != null && Number(digit) > max) {
    // "5" no início do dia → "05" e pula pro próximo segmento
    arr[pos] = "0";
    arr[pos + 1] = digit;
    caretAfter = pos + 2;
  } else {
    arr[pos] = digit;
    caretAfter = pos + 1;
  }
  // digitando no fim: põe a barra/espaço/dois-pontos seguinte sozinho
  if (caretAfter >= arr.length) appendSeparators(template, arr);
  const ns = nextSlot(template, caretAfter);
  const caret = ns < 0 ? Math.min(caretAfter, arr.length) : Math.min(ns, arr.length);
  return { text: arr.join("").slice(0, template.length), caret };
}

/** Backspace: no fim apaga; no meio só volta e seleciona o dígito anterior (pra sobrescrever). */
export function backspace(template: string, text: string, selStart: number, selEnd: number): MaskState {
  if (selStart === 0 && selEnd >= text.length) return { text: "", caret: 0 };
  if (selEnd !== selStart && selEnd < text.length) {
    // seleção no meio: seleciona o 1º dígito dela pra ser sobrescrito
    const p = nextSlot(template, selStart);
    return { text, caret: p, selEnd: p + 1 };
  }
  if (selStart >= text.length || selEnd >= text.length) {
    // apagando do fim
    let arr = text.slice(0, selStart === selEnd ? text.length - 1 : selStart).split("");
    while (arr.length && !isSlot(template, arr.length - 1)) arr = arr.slice(0, -1);
    return { text: arr.join(""), caret: arr.length };
  }
  const p = prevSlot(template, selStart - 1);
  if (p < 0) return { text, caret: 0 };
  return { text, caret: p, selEnd: p + 1 };
}

/** Delete: seleciona o dígito na posição do cursor pra ser sobrescrito. */
export function del(template: string, text: string, selStart: number): MaskState {
  const p = nextSlot(template, selStart);
  if (p < 0 || p >= text.length) return { text, caret: selStart };
  return { text, caret: p, selEnd: p + 1 };
}

/** Texto colado/autocompletado: aceita "02/10/2026", "2026-10-02", "02102026" etc. */
export function fromLooseText(template: string, raw: string): string {
  const iso = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  let digits: string;
  if (iso) digits = `${iso[3]}${iso[2]}${iso[1]}${iso[4] ?? ""}${iso[5] ?? ""}`;
  else digits = raw.replace(/\D/g, "");
  if (template === TIME_TEMPLATE) digits = raw.replace(/\D/g, "");
  const arr: string[] = [];
  let di = 0;
  for (let i = 0; i < template.length && di < digits.length; i++) {
    if (isSlot(template, i)) arr.push(digits[di++]);
    else arr.push(template[i]);
  }
  return arr.join("");
}

// ------------------------------------------------------------------
// Conversão texto ⇄ ISO (sem Date do navegador: só números)
// ------------------------------------------------------------------
export function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "02/10/2026" → "2026-10-02"; "02/10/2026 14:30" → "2026-10-02T14:30"; inválido/incompleto → null */
export function textToIso(template: string, text: string): string | null {
  if (text.length !== template.length) return null;
  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  if (template === DATETIME_TEMPLATE) {
    if (m[4] == null || Number(m[4]) > 23 || Number(m[5]) > 59) return null;
    return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}`;
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** ISO (ou "AAAA-MM-DD HH:MM:SS…") → texto do molde. */
export function isoToText(template: string, iso: string): string {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return "";
  if (template === DATETIME_TEMPLATE) return `${m[3]}/${m[2]}/${m[1]} ${m[4] ?? "00"}:${m[5] ?? "00"}`;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Seta ↑/↓: soma ±1 no segmento onde está o cursor (dia, mês, ano, hora, minuto). */
export function stepSegment(template: string, text: string, caret: number, delta: 1 | -1): string | null {
  const iso = textToIso(template, text);
  if (!iso) return null;
  const [datePart, timePart = "00:00"] = iso.split("T");
  let [y, mo, d] = datePart.split("-").map(Number);
  let [hh, mi] = timePart.split(":").map(Number);
  const letter = template[Math.min(caret, template.length - 1)] === "/" || template[caret] === " " || template[caret] === ":"
    ? template[Math.max(0, caret - 1)]
    : template[Math.min(caret, template.length - 1)];
  const minute = letter === "M" && caret >= 13;
  if (letter === "D") {
    const t = new Date(Date.UTC(y, mo - 1, d + delta));
    y = t.getUTCFullYear(); mo = t.getUTCMonth() + 1; d = t.getUTCDate();
  } else if (letter === "M" && !minute) {
    const t = new Date(Date.UTC(y, mo - 1 + delta, 1));
    y = t.getUTCFullYear(); mo = t.getUTCMonth() + 1; d = Math.min(d, daysInMonth(y, mo));
  } else if (letter === "A") {
    y += delta; d = Math.min(d, daysInMonth(y, mo));
  } else if (letter === "H" || minute) {
    const t = new Date(Date.UTC(y, mo - 1, d, hh + (letter === "H" ? delta : 0), mi + (minute ? delta : 0)));
    y = t.getUTCFullYear(); mo = t.getUTCMonth() + 1; d = t.getUTCDate(); hh = t.getUTCHours(); mi = t.getUTCMinutes();
  } else return null;
  const p2 = (n: number) => String(n).padStart(2, "0");
  return template === DATETIME_TEMPLATE
    ? `${p2(d)}/${p2(mo)}/${y} ${p2(hh)}:${p2(mi)}`
    : `${p2(d)}/${p2(mo)}/${y}`;
}

/** Hoje em São Paulo (nunca a data/fuso do navegador). */
export function todaySP(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}
