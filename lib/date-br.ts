// lib/date-br.ts
const brDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Converte um timestamp (ex.: `data_pagamento`, coluna `timestamptz`) para a
 * data local do Brasil no formato YYYY-MM-DD. Necessário porque o Postgres
 * devolve esses campos em UTC — um pagamento feito às 23h de BRT já virou o
 * dia seguinte em UTC, então um `.split("T")[0]` ingênuo classifica esse
 * pagamento no dia (ou mês) errado.
 */
export function toBRDateStr(iso: string): string {
  return brDateFormatter.format(new Date(iso));
}

/**
 * Data "de hoje" (ou de um Date arbitrário) no fuso de São Paulo, como
 * YYYY-MM-DD. Usada pra comparar "qual é o dia local agora" sem depender do
 * fuso do servidor/navegador. Antes duplicada de forma idêntica em 3 páginas.
 */
export function isoDateInSaoPaulo(d: Date = new Date()): string {
  return brDateFormatter.format(d);
}

// ------------------------------------------------------------------
// ✅ 03/10/2026, pedido do Márcio: exibição SEMPRE em pt-BR e no horário de
// São Paulo — nunca no idioma/fuso do navegador (navegador em inglês trocava
// dia e mês: 08/09 virava 09/08). Use estes helpers em vez de
// toLocaleDateString()/toLocaleString() soltos.
// ------------------------------------------------------------------
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const spDateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const spDateShortFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
});
const spDateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const spTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function toDateOrNull(v: string | number | Date | null | undefined): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * "DD/MM/AAAA". Data sem hora ("2026-10-02", coluna date) é formatada pelos
 * números, SEM passar por fuso (new Date("2026-10-02") é meia-noite UTC = dia
 * anterior em SP). Timestamp → dia em São Paulo. Inválido/vazio → fallback.
 */
export function formatDateBR(v: string | number | Date | null | undefined, fallback = "—"): string {
  if (typeof v === "string") {
    const m = v.match(DATE_ONLY_RE);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const d = toDateOrNull(v);
  return d ? spDateFmt.format(d) : fallback;
}

/** "DD/MM" (mesmas regras de formatDateBR). */
export function formatDateShortBR(v: string | number | Date | null | undefined, fallback = "—"): string {
  if (typeof v === "string") {
    const m = v.match(DATE_ONLY_RE);
    if (m) return `${m[3]}/${m[2]}`;
  }
  const d = toDateOrNull(v);
  return d ? spDateShortFmt.format(d) : fallback;
}

/** "DD/MM/AAAA HH:MM" em São Paulo (24h). Data sem hora → só a data. */
export function formatDateTimeBR(v: string | number | Date | null | undefined, fallback = "—"): string {
  if (typeof v === "string" && DATE_ONLY_RE.test(v)) return formatDateBR(v, fallback);
  const d = toDateOrNull(v);
  return d ? spDateTimeFmt.format(d).replace(",", "") : fallback;
}

/** "HH:MM" em São Paulo (24h). */
export function formatTimeBR(v: string | number | Date | null | undefined, fallback = "—"): string {
  const d = toDateOrNull(v);
  return d ? spTimeFmt.format(d) : fallback;
}

/**
 * Soma N anos numa data pura "AAAA-MM-DD" — só números (UTC), nunca o fuso
 * do servidor/navegador. 29/02 + 1 ano = 01/03 (mesmo comportamento do
 * setFullYear que era usado antes).
 */
export function addYearsToIsoDate(iso: string, years: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y + years, m - 1, d));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
