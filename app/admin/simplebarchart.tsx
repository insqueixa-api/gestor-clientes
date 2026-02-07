"use client";

import React, { useMemo, useState } from "react";

export type SimpleBarChartDatum = {
  label: string; // ex "Dia 7"
  value: number; // usado pra altura
  displayValue: number; // texto exibido
  tooltipTitle: string;
  tooltipContent: string;
};

interface SimpleBarChartProps {
  data: SimpleBarChartDatum[];
  colorClass?: string; // ex: "from-emerald-400 to-emerald-600"
  label?: string; // ex: "Cadastros"
  heightClass?: string; // ex: "h-40 sm:h-56"
}

export function SimpleBarChart({
  data,
  colorClass = "from-zinc-400 to-zinc-600",
  label,
  heightClass = "h-44 sm:h-56",
}: SimpleBarChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const maxValue = useMemo(() => Math.max(...data.map((d) => d.value), 1), [data]);

  // 4 linhas horizontais
  const yTicks = useMemo(() => {
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const pct = (i / steps) * 100;
      const v = Math.round((maxValue * (steps - i)) / steps);
      return { pct, v };
    });
  }, [maxValue]);

  const active = activeIndex != null ? data[activeIndex] : null;

  function pick(i: number) {
    setActiveIndex((cur) => (cur === i ? null : i));
  }

  return (
    <div className="w-full">
      {/* Tooltip “fixo” (bom pra touch) */}
      <div className="mb-3 min-h-[44px]">
        {active ? (
          <div className="inline-flex max-w-full items-start gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="min-w-0">
              <div className="font-bold truncate">{active.tooltipTitle}</div>
              <div className="text-zinc-600 dark:text-zinc-300 truncate">{active.tooltipContent}</div>
            </div>
            <button
              className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
              onClick={() => setActiveIndex(null)}
              type="button"
            >
              limpar
            </button>
          </div>
        ) : (
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Toque/clique em uma barra.
          </div>
        )}
      </div>

      <div className={`relative w-full ${heightClass} rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900`}>
        {/* Grid horizontal + labels Y */}
        <div className="pointer-events-none absolute inset-3">
          {yTicks.map((t) => (
            <div
              key={t.pct}
              className="absolute left-0 right-0 border-t border-dashed border-zinc-200/70 dark:border-zinc-700/60"
              style={{ top: `${t.pct}%` }}
            />
          ))}
        </div>

        {/* Área do chart */}
        <div className="relative h-full">
          {/* Colunas com largura máxima (evita retângulo gigante com poucos pontos) */}
          <div className="flex h-full items-end gap-2 overflow-x-auto pb-2">
            {data.map((item, i) => {
              const h = (item.value / maxValue) * 100;
              const isActive = i === activeIndex;

              return (
                <button
                  key={`${item.label}-${i}`}
                  type="button"
                  onClick={() => pick(i)}
                  onMouseEnter={() => setActiveIndex((cur) => (cur == null ? i : cur))}
                  className="group relative flex h-full shrink-0 flex-col items-center justify-end outline-none"
                  style={{ width: 28 }} // largura fixa por barra
                  aria-label={`${label ?? "barra"} ${item.label}: ${item.displayValue}`}
                >
                  {/* valor pequeno acima da barra (só quando ativa/hover) */}
                  <div className={`mb-1 text-[10px] font-semibold tabular-nums transition-opacity ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                    {item.displayValue}
                  </div>

                  {/* barra */}
                  <div
                    className={[
                      "w-full rounded-md bg-gradient-to-t transition-all duration-200 ease-out",
                      colorClass,
                      isActive ? "opacity-100 ring-2 ring-black/10 dark:ring-white/10" : "opacity-80 group-hover:opacity-100",
                    ].join(" ")}
                    style={{
                      height: `${Math.max(6, h)}%`, // nunca fica “colada” invisível
                    }}
                  />

                  {/* eixo X (dia) */}
                  <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {item.label.replace("Dia ", "")}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
