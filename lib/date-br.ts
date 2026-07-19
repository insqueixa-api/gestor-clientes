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
