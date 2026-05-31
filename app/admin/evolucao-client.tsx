"use client";

import React, { useEffect, useState } from "react";
import { MixedChart, MixedChartDatum } from "./mixed-chart";
import type { MonthData } from "./evolucao-chart";

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const fmtBRLShort = (v: number) => {
  if (v === 0) return "—";
  if (Math.abs(v) >= 1000)
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    }).format(v);
  return fmtBRL(v);
};

export function EvolucaoFinanceiraClient({ data }: { data: MonthData[] }) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Mobile: últimos 6 meses. Desktop: todos os 12.
  const sliced = isMobile ? data.slice(-6) : data;

  const chartData: MixedChartDatum[] = sliced.map((m) => ({
    label: m.label,
    bar1: m.bar1,
    bar2: m.bar2,
    line1: m.line1,
    line2: m.line2,
    tooltipTitle: `Resumo - ${m.label}`,
    tooltipItems: [
      { label: "Receita (Prevista)", value: fmtBRL(m.bar1), colorClass: "text-emerald-500" },
      { label: "Despesa (Prevista)", value: fmtBRL(m.bar2), colorClass: "text-rose-500" },
      { isSeparator: true, label: "", value: "", colorClass: "" },
      { label: "Receita (Executada)", value: fmtBRL(m.line1), colorClass: "text-emerald-600 font-bold" },
      { label: "Despesa (Executada)", value: fmtBRL(m.line2), colorClass: "text-rose-600 font-bold" },
    ],
  }));

  const tableRows = [
    {
      label: "Receita Prevista",
      dot: "bg-emerald-300",
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50/60 dark:bg-emerald-500/5",
      bold: false,
      values: sliced.map((m) => m.bar1),
    },
    {
      label: "Receita Executada",
      dot: "bg-emerald-600",
      color: "text-emerald-700 dark:text-emerald-300",
      bg: "bg-emerald-50/30 dark:bg-emerald-500/[0.03]",
      bold: true,
      values: sliced.map((m) => m.line1),
    },
    { divider: true } as const,
    {
      label: "Despesa Prevista",
      dot: "bg-rose-300",
      color: "text-rose-500 dark:text-rose-400",
      bg: "bg-rose-50/60 dark:bg-rose-500/5",
      bold: false,
      values: sliced.map((m) => m.bar2),
    },
    {
      label: "Despesa Executada",
      dot: "bg-rose-600",
      color: "text-rose-700 dark:text-rose-300",
      bg: "bg-rose-50/30 dark:bg-rose-500/[0.03]",
      bold: true,
      values: sliced.map((m) => m.line2),
    },
  ];

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">

      {/* ── Header ── */}
      <div className="px-4 sm:px-6 pt-5 pb-3 flex items-start justify-between border-b border-zinc-100 dark:border-zinc-800">
        <div>
          <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
            Evolução Consolidada{" "}
            <span className="font-normal text-zinc-400 dark:text-zinc-500 text-sm">
              ({isMobile ? "6" : "12"} meses)
            </span>
          </h3>
          <div className="flex items-center gap-4 mt-1.5 flex-wrap">
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              <span className="inline-block w-3 h-3 rounded-sm bg-emerald-200 dark:bg-emerald-500/30" />
              <span className="inline-block w-3 h-3 rounded-sm bg-rose-200 dark:bg-rose-500/30 -ml-1.5" />
              Barras: Previsto
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              <span className="inline-block w-5 h-0.5 bg-emerald-500 rounded-full" />
              <span className="inline-block w-5 h-0.5 bg-rose-500 rounded-full -ml-1" />
              Linhas: Executado
            </span>
          </div>
        </div>
      </div>

      {/* ── Gráfico ── */}
      <div className="px-2 sm:px-4 pt-4 pb-2">
        <MixedChart data={chartData} heightClass="h-56 sm:h-72" />
      </div>

      {/* ── Tabela de valores ── */}
      <div className="border-t border-zinc-100 dark:border-zinc-800 overflow-x-auto">
        <table
          className="w-full text-right border-collapse"
          style={{ minWidth: `${sliced.length * 88 + 156}px` }}
        >
          {/* Cabeçalho com os meses */}
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              <th className="sticky left-0 z-10 bg-white dark:bg-zinc-900 px-3 sm:px-4 py-2 text-left w-36 sm:w-44 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                Período
              </th>
              {sliced.map((m) => (
                <th
                  key={m.key}
                  className="px-2 py-2 text-[9px] sm:text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider whitespace-nowrap min-w-[76px] sm:min-w-[88px]"
                >
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {tableRows.map((row, ri) => {
              if ("divider" in row && row.divider) {
                return (
                  <tr key={`div-${ri}`}>
                    <td
                      colSpan={sliced.length + 1}
                      className="py-0"
                    >
                      <div className="h-px bg-zinc-100 dark:bg-zinc-800 mx-3 sm:mx-4" />
                    </td>
                  </tr>
                );
              }

              const r = row as Exclude<typeof row, { divider: true }>;

              return (
                <tr key={r.label} className={r.bg}>
                  {/* Label fixo */}
                  <td className={`sticky left-0 z-10 ${r.bg} px-3 sm:px-4 py-2 sm:py-2.5 text-left`}>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${r.dot}`} />
                      <span
                        className={`text-[10px] sm:text-[11px] whitespace-nowrap ${r.color} ${r.bold ? "font-black" : "font-semibold opacity-75"}`}
                      >
                        {r.label}
                      </span>
                    </div>
                  </td>

                  {/* Valores por mês */}
                  {r.values.map((val, ci) => (
                    <td
                      key={ci}
                      className={`px-2 py-2 sm:py-2.5 text-[10px] sm:text-[11px] tabular-nums whitespace-nowrap ${
                        r.bold ? `font-black ${r.color}` : `font-medium ${r.color} opacity-60`
                      } ${val === 0 ? "opacity-20" : ""}`}
                    >
                      {fmtBRLShort(val)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Padding bottom ── */}
      <div className="h-3" />
    </div>
  );
}
