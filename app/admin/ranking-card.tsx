"use client";

/**
 * RankingCard — substitui o BarCard genérico
 * Uso:
 *   <RankingCard title="Top Servidores" items={topServersItems} accentColor="sky" />
 */

import React from "react";

type BarItem = {
  label: string;
  value: number;
};

type AccentColor = "sky" | "emerald" | "violet" | "rose" | "amber" | "indigo";

interface RankingCardProps {
  title: string;
  subtitle?: string;
  items: BarItem[];
  accentColor?: AccentColor;
  valueLabel?: string;
  formatValue?: (v: number) => string;
  mode?: "count" | "currency";
  topN?: number;
}
const fmtInt = (v: number) => new Intl.NumberFormat("pt-BR").format(v);
const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const accents: Record<AccentColor, {
  bar: string;        // gradient para a barra
  barBg: string;      // fundo da barra (track)
  rank: string;       // cor do número de rank
  rankBg: string;     // fundo do badge de rank
  dot: string;        // cor do dot decorativo
  label: string;      // cor do label
  value: string;      // cor do valor
  topBar: string;     // cor especial pra 1º lugar
}> = {
  sky: {
    bar:    "linear-gradient(to right,#0284c7,#38bdf8)",
    barBg:  "bg-sky-100 dark:bg-sky-950/30",
    rank:   "text-sky-600 dark:text-sky-400",
    rankBg: "bg-sky-50 dark:bg-sky-900/40",
    dot:    "bg-sky-400",
    label:  "text-zinc-700 dark:text-zinc-200",
    value:  "text-sky-700 dark:text-sky-300",
    topBar: "linear-gradient(to right,#0369a1,#0ea5e9,#7dd3fc)",
  },
  emerald: {
    bar:    "linear-gradient(to right,#059669,#34d399)",
    barBg:  "bg-emerald-100 dark:bg-emerald-950/30",
    rank:   "text-emerald-600 dark:text-emerald-400",
    rankBg: "bg-emerald-50 dark:bg-emerald-900/40",
    dot:    "bg-emerald-400",
    label:  "text-zinc-700 dark:text-zinc-200",
    value:  "text-emerald-700 dark:text-emerald-300",
    topBar: "linear-gradient(to right,#065f46,#059669,#6ee7b7)",
  },
  violet: {
    bar:    "linear-gradient(to right,#7c3aed,#a78bfa)",
    barBg:  "bg-violet-100 dark:bg-violet-950/30",
    rank:   "text-violet-600 dark:text-violet-400",
    rankBg: "bg-violet-50 dark:bg-violet-900/40",
    dot:    "bg-violet-400",
    label:  "text-zinc-700 dark:text-zinc-200",
    value:  "text-violet-700 dark:text-violet-300",
    topBar: "linear-gradient(to right,#4c1d95,#7c3aed,#c4b5fd)",
  },
  rose: {
    bar:    "linear-gradient(to right,#e11d48,#fb7185)",
    barBg:  "bg-rose-100 dark:bg-rose-950/30",
    rank:   "text-rose-600 dark:text-rose-400",
    rankBg: "bg-rose-50 dark:bg-rose-900/40",
    dot:    "bg-rose-400",
    label:  "text-zinc-700 dark:text-zinc-200",
    value:  "text-rose-700 dark:text-rose-300",
    topBar: "linear-gradient(to right,#881337,#e11d48,#fda4af)",
  },
  amber: {
    bar:    "linear-gradient(to right,#d97706,#fbbf24)",
    barBg:  "bg-amber-100 dark:bg-amber-950/30",
    rank:   "text-amber-600 dark:text-amber-400",
    rankBg: "bg-amber-50 dark:bg-amber-900/40",
    dot:    "bg-amber-400",
    label:  "text-zinc-700 dark:text-zinc-200",
    value:  "text-amber-700 dark:text-amber-300",
    topBar: "linear-gradient(to right,#92400e,#d97706,#fcd34d)",
  },
  indigo: {
    bar:    "linear-gradient(to right,#4338ca,#818cf8)",
    barBg:  "bg-indigo-100 dark:bg-indigo-950/30",
    rank:   "text-indigo-600 dark:text-indigo-400",
    rankBg: "bg-indigo-50 dark:bg-indigo-900/40",
    dot:    "bg-indigo-400",
    label:  "text-zinc-700 dark:text-zinc-200",
    value:  "text-indigo-700 dark:text-indigo-300",
    topBar: "linear-gradient(to right,#1e1b4b,#4338ca,#a5b4fc)",
  },
};

const medals = ["🥇", "🥈", "🥉"];

export function RankingCard({
  title, subtitle, items, accentColor = "sky", valueLabel, formatValue, mode = "count", topN = 5,
}: RankingCardProps) {
  const defaultFormat = mode === "currency" ? fmtBRL : fmtInt;
  const fmt = formatValue ?? defaultFormat;
  const c = accents[accentColor];
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800">
        <div>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">{subtitle}</p>
          )}
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md ${c.rankBg} ${c.rank}`}>
          Top {items.length}
        </span>
      </div>

      {/* Items */}
      <div className="px-5 py-4 space-y-3">
        {items.length === 0 && (
          <p className="text-zinc-400 dark:text-zinc-600 text-sm py-2">Sem dados disponíveis.</p>
        )}

        {items.map((item, idx) => {
          const pct = (item.value / max) * 100;
          const isTop = idx === 0;
          const barGrad = isTop ? c.topBar : c.bar;

          return (
            <div key={item.label} className="group">
              {/* Row */}
              <div className="flex items-center gap-3 mb-1.5">
                {/* Rank badge */}
                <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${c.rankBg}`}>
                  {idx < 3 ? (
                    <span className="text-[13px] leading-none">{medals[idx]}</span>
                  ) : (
                    <span className={`text-[10px] font-bold tabular-nums ${c.rank}`}>{idx + 1}</span>
                  )}
                </div>

                {/* Label */}
                <span
                  className={`flex-1 text-[13px] font-medium truncate ${c.label} group-hover:opacity-100`}
                  title={item.label}
                >
                  {item.label}
                </span>

                {/* Value */}
                <span className={`text-[13px] font-bold tabular-nums flex-shrink-0 ${c.value}`}>
                  {fmt(item.value)}
                  {valueLabel && (
                    <span className="text-[10px] font-normal ml-1 opacity-60">{valueLabel}</span>
                  )}
                </span>
              </div>

              {/* Progress bar */}
              <div className={`relative h-1.5 rounded-full overflow-hidden ml-9 ${c.barBg}`}>
                <div
                  className="absolute left-0 top-0 h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${pct}%`,
                    background: barGrad,
                    boxShadow: isTop ? `0 0 6px rgba(0,0,0,0.15)` : "none",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
