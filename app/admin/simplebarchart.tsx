"use client";

import React, { useMemo, useState } from "react";

export type SimpleBarChartDatum = {
  label: string; // ex: "Dia 1", "Dia 2"
  value: number; // usado para escala
  displayValue: number; // valor exibido
  tooltipTitle: string; // ex: "1 de fevereiro"
  tooltipContent: string; // ex: "10 Clientes / 2 Testes"
};

interface SimpleBarChartProps {
  data: SimpleBarChartDatum[];
  colorClass?: string; // ex: "from-emerald-400 to-emerald-600 ring-emerald-500"
  label?: string; // ex: "Cadastros"
  unitPrefix?: string; // ex: "R$"
  heightClass?: string; // ex: "h-44 sm:h-56"
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function SimpleBarChart({
  data,
  colorClass = "from-zinc-400 to-zinc-600 ring-zinc-400",
  label,
  unitPrefix,
  heightClass = "h-44 sm:h-56",
}: SimpleBarChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const safeData = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const maxValue = useMemo(() => {
    const m = Math.max(...safeData.map((d) => (Number.isFinite(d.value) ? d.value : 0)), 0);
    // dá um “respiro” pra barras não baterem no topo
    return Math.max(m, 1);
  }, [safeData]);

  // 4 linhas de referência (25/50/75/100)
  const gridTicks = useMemo(() => {
    const steps = [0.25, 0.5, 0.75, 1];
    return steps.map((s) => ({
      pct: s * 100,
      value: Math.round(maxValue * s),
    }));
  }, [maxValue]);

  const active = activeIndex !== null ? safeData[activeIndex] : null;

  // Mostra alguns rótulos no eixo X (não precisa mostrar todos)
  const xLabelEvery = useMemo(() => {
    const n = safeData.length;
    if (n <= 10) return 1;
    if (n <= 16) return 2;
    if (n <= 24) return 3;
    return 4;
  }, [safeData.length]);

  return (
    <div className="w-full">
      {/* Header do gráfico */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          {label ? (
            <div className="text-xs font-bold tracking-wide text-zinc-700 dark:text-zinc-200">
              {label}
            </div>
          ) : null}
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Toque/clique em uma barra para ver detalhes
          </div>
        </div>

        {/* “Mini painel” do item ativo */}
        <div className="shrink-0">
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white/70 dark:bg-zinc-950/30 px-2.5 py-2 shadow-sm">
            {active ? (
              <>
                <div className="text-[11px] font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                  {active.tooltipTitle}
                </div>
                <div className="text-[11px] text-zinc-600 dark:text-zinc-300 mt-0.5">
                  {active.tooltipContent}
                </div>
              </>
            ) : (
              <>
                <div className="text-[11px] font-bold text-zinc-900 dark:text-zinc-100 leading-tight">
                  Selecione uma barra
                </div>
                <div className="text-[11px] text-zinc-600 dark:text-zinc-300 mt-0.5">
                  para ver o detalhe
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Área do gráfico */}
      <div
        className={[
          "relative w-full rounded-xl border border-zinc-200 dark:border-zinc-800",
          "bg-white dark:bg-zinc-950/30 shadow-sm overflow-hidden",
          "px-3 pt-3 pb-2",
          heightClass,
        ].join(" ")}
      >
        {/* Grid horizontal */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="relative w-full h-full">
            {gridTicks.map((t) => (
              <div
                key={t.pct}
                className="absolute left-0 right-0"
                style={{ bottom: `${t.pct}%` }}
              >
                <div className="border-t border-dashed border-zinc-200/80 dark:border-white/10" />
              </div>
            ))}
          </div>
        </div>

        {/* Valores (eixo Y) */}
        <div className="absolute left-2 top-2 bottom-6 flex flex-col justify-between pointer-events-none">
          {[...gridTicks].reverse().map((t) => (
            <div key={t.pct} className="text-[10px] text-zinc-400 dark:text-white/30">
              {unitPrefix ? `${unitPrefix} ` : ""}
              {t.value}
            </div>
          ))}
        </div>

        {/* Barras */}
        <div className="relative h-full w-full">
          <div className="h-full flex items-end gap-1.5">
            {safeData.map((item, index) => {
              const isActive = activeIndex === index;

              const raw = Number.isFinite(item.value) ? item.value : 0;
              const pct = clamp((raw / maxValue) * 100, 0, 100);

              return (
                <button
                  key={index}
                  type="button"
                  className={[
                    "group relative flex-1 h-full flex flex-col justify-end items-center",
                    "focus:outline-none",
                  ].join(" ")}
                  onClick={() => setActiveIndex((prev) => (prev === index ? null : index))}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex((prev) => (prev === index ? null : prev))}
                  aria-label={`${item.tooltipTitle}: ${item.tooltipContent}`}
                >
                  {/* Tooltip flutuante (hover) + também ajuda no desktop */}
                  <div
                    className={[
                      "absolute bottom-full mb-2 z-20",
                      "opacity-0 group-hover:opacity-100 transition-opacity duration-150",
                      "pointer-events-none",
                    ].join(" ")}
                  >
                    <div className="relative">
                      <div className="bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs rounded-md py-1.5 px-3 shadow-xl whitespace-nowrap text-center">
                        <div className="font-bold mb-0.5">{item.tooltipTitle}</div>
                        <div className="opacity-90 font-medium">{item.tooltipContent}</div>
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-900 dark:border-t-white" />
                      </div>
                    </div>
                  </div>

                  {/* Barra */}
                  <div className="w-full flex items-end justify-center">
                    <div
                      className={[
                        "w-full max-w-[14px] sm:max-w-[16px] min-h-[6px] rounded-t-md",
                        "bg-gradient-to-t",
                        colorClass,
                        "transition-all duration-200 ease-out origin-bottom",
                        isActive ? "opacity-100 scale-y-[1.06] ring-2" : "opacity-80 hover:opacity-100",
                      ].join(" ")}
                      style={{ height: `${pct}%` }}
                    />
                  </div>

                  {/* Valor acima da barra (somente em telas >= sm ou quando ativo) */}
                  <div
                    className={[
                      "mt-1 text-[10px] font-bold",
                      "text-zinc-500 dark:text-white/40",
                      "hidden sm:block",
                      isActive ? "!block text-zinc-900 dark:text-zinc-100" : "",
                    ].join(" ")}
                  >
                    {Number.isFinite(item.displayValue) ? item.displayValue : ""}
                  </div>

                  {/* Eixo X */}
                  <div className="mt-1 w-full text-center">
                    <span
                      className={[
                        "text-[10px] leading-none",
                        "text-zinc-400 dark:text-white/30",
                        isActive ? "text-zinc-900 dark:text-zinc-100 font-bold" : "",
                        index % xLabelEvery === 0 ? "inline" : "hidden sm:hidden",
                        // no sm+ mostra mais labels
                        index % xLabelEvery === 0 ? "sm:inline" : "sm:hidden",
                      ].join(" ")}
                    >
                      {item.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Rodapé (baseline) */}
          <div className="absolute left-0 right-0 bottom-5 border-t border-zinc-200 dark:border-white/10" />
        </div>
      </div>
    </div>
  );
}
