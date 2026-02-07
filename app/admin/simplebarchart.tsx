"use client";

import React, { useMemo, useState } from "react";

export type SimpleBarChartDatum = {
  label: string;
  value: number;
  displayValue: number;
  tooltipTitle: string;
  tooltipContent: string;
};

interface SimpleBarChartProps {
  data: SimpleBarChartDatum[];
  colorClass?: string;     // ex: "from-emerald-400 to-emerald-600 ring-emerald-500"
  label?: string;          // não vamos mais mostrar “Cadastros/BRL” na tela, só usa no aria
  heightClass?: string;    // ex: "h-40 sm:h-56"
}

export function SimpleBarChart({
  data,
  colorClass = "from-zinc-400 to-zinc-600 ring-zinc-500",
  label,
  heightClass = "h-40 sm:h-56",
}: SimpleBarChartProps) {
  const [selected, setSelected] = useState<number | null>(null);

  const maxValue = useMemo(() => Math.max(...data.map((d) => d.value), 1), [data]);

  const selectedItem = selected != null ? data[selected] : null;

  function pick(i: number) {
    setSelected((prev) => (prev === i ? null : i));
  }

  return (
    <div className="w-full" role="img" aria-label={label ? `Gráfico: ${label}` : "Gráfico"}>
      {/* Tooltip compacto (mobile-friendly) */}
      <div className="mb-2 min-h-[40px]">
        {selectedItem ? (
          <div className="inline-flex max-w-full flex-col gap-0.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
              {selectedItem.tooltipTitle}
            </div>
            <div className="text-zinc-600 dark:text-zinc-300">
              {selectedItem.tooltipContent}
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Toque/clique em uma barra.
          </div>
        )}
      </div>

      <div className={`relative w-full ${heightClass} rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950`}>
        {/* área das barras (reserva espaço pro eixo X) */}
        <div className="absolute inset-x-3 top-3 bottom-8 flex items-end gap-2">
          {data.map((item, i) => {
            const h = Math.max(2, (item.value / maxValue) * 100);
            const isSel = selected === i;

            return (
              <button
                key={`${item.label}-${i}`}
                type="button"
                onClick={() => pick(i)}
                className="group relative flex-1 h-full flex flex-col justify-end outline-none"
                aria-label={`${item.tooltipTitle}: ${item.tooltipContent}`}
              >
                <div
                  className={[
                    "w-full rounded-md bg-gradient-to-t transition-all duration-150 origin-bottom",
                    colorClass,
                    isSel ? "opacity-100 ring-2" : "opacity-85 group-hover:opacity-100",
                  ].join(" ")}
                  style={{ height: `${h}%` }}
                />

                {/* valor pequeno aparece no hover desktop / selecionado */}
                <div className="pointer-events-none absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-semibold text-zinc-700 opacity-0 transition-opacity dark:text-zinc-200 sm:group-hover:opacity-100">
                  {item.displayValue}
                </div>
              </button>
            );
          })}
        </div>

        {/* eixo X com labels (dias) */}
        <div className="absolute inset-x-3 bottom-2 flex gap-2">
          {data.map((item, i) => (
            <div
              key={`x-${item.label}-${i}`}
              className="flex-1 text-center text-[10px] text-zinc-500 dark:text-zinc-400 truncate"
            >
              {item.label.replace("Dia ", "")}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
