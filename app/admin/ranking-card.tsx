"use client";

import React, { useState } from "react";

type BarItem = {
  label: string;
  value: number;
  logo_url?: string | null;
};

type AccentColor = "sky" | "emerald" | "violet" | "rose" | "amber" | "indigo";

interface RankingCardProps {
  title: string;
  subtitle?: string;
  items?: BarItem[]; // ✅ Agora opcional
  itemsPrevisto?: BarItem[]; // ✅ Novo
  itemsExecutado?: BarItem[]; // ✅ Novo
  accentColor?: AccentColor;
  valueLabel?: string;
  formatValue?: (v: number) => string;
  mode?: "count" | "currency";
}
const fmtInt = (v: number) => new Intl.NumberFormat("pt-BR").format(v);
const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    v,
  );

const accents: Record<
  AccentColor,
  {
    bar: string; // gradient para a barra
    barBg: string; // fundo da barra (track)
    rank: string; // cor do número de rank
    rankBg: string; // fundo do badge de rank
    dot: string; // cor do dot decorativo
    label: string; // cor do label
    value: string; // cor do valor
    topBar: string; // cor especial pra 1º lugar
  }
> = {
  sky: {
    bar: "linear-gradient(to right,#0284c7,#38bdf8)",
    barBg: "bg-sky-500/20",
    rank: "text-sky-400",
    rankBg: "bg-sky-500/10",
    dot: "bg-sky-400",
    label: "text-foreground/90",
    value: "text-sky-400",
    topBar: "linear-gradient(to right,#0369a1,#0ea5e9,#7dd3fc)",
  },
  emerald: {
    bar: "linear-gradient(to right,#059669,#34d399)",
    barBg: "bg-emerald-100 dark:bg-emerald-950/30",
    rank: "text-emerald-400",
    rankBg: "bg-emerald-500/10",
    dot: "bg-emerald-400",
    label: "text-foreground/90",
    value: "text-emerald-400",
    topBar: "linear-gradient(to right,#065f46,#059669,#6ee7b7)",
  },
  violet: {
    bar: "linear-gradient(to right,#7c3aed,#a78bfa)",
    barBg: "bg-violet-100 dark:bg-violet-950/30",
    rank: "text-violet-600 dark:text-violet-400",
    rankBg: "bg-violet-50 dark:bg-violet-900/40",
    dot: "bg-violet-400",
    label: "text-foreground/90",
    value: "text-violet-700 dark:text-violet-300",
    topBar: "linear-gradient(to right,#4c1d95,#7c3aed,#c4b5fd)",
  },
  rose: {
    bar: "linear-gradient(to right,#e11d48,#fb7185)",
    barBg: "bg-rose-500/20",
    rank: "text-rose-400",
    rankBg: "bg-rose-500/10",
    dot: "bg-rose-400",
    label: "text-foreground/90",
    value: "text-rose-400",
    topBar: "linear-gradient(to right,#881337,#e11d48,#fda4af)",
  },
  amber: {
    bar: "linear-gradient(to right,#d97706,#fbbf24)",
    barBg: "bg-amber-100 dark:bg-amber-950/30",
    rank: "text-amber-600 dark:text-amber-400",
    rankBg: "bg-amber-500/10",
    dot: "bg-amber-400",
    label: "text-foreground/90",
    value: "text-amber-700 dark:text-amber-300",
    topBar: "linear-gradient(to right,#92400e,#d97706,#fcd34d)",
  },
  indigo: {
    bar: "linear-gradient(to right,#4338ca,#818cf8)",
    barBg: "bg-indigo-100 dark:bg-indigo-950/30",
    rank: "text-indigo-600 dark:text-indigo-400",
    rankBg: "bg-indigo-50 dark:bg-indigo-900/40",
    dot: "bg-indigo-400",
    label: "text-foreground/90",
    value: "text-indigo-700 dark:text-indigo-300",
    topBar: "linear-gradient(to right,#1e1b4b,#4338ca,#a5b4fc)",
  },
};

const medals = ["🥇", "🥈", "🥉"];

export function RankingCard({
  title,
  subtitle,
  items = [],
  itemsPrevisto,
  itemsExecutado,
  accentColor = "sky",
  valueLabel,
  formatValue,
  mode = "count",
}: RankingCardProps) {
  // ✅ Controle da visão ativa
  const [view, setView] = useState<"previsto" | "executado">("executado");

  const defaultFormat = mode === "currency" ? fmtBRL : fmtInt;
  const fmt = formatValue ?? defaultFormat;
  const c = accents[accentColor];

  // ✅ Se o componente receber as duas props do financeiro, ativa o toggle
  const hasToggle = !!itemsPrevisto && !!itemsExecutado;

  // ✅ Define qual array de dados usar (O selecionado ou o padrão)
  const currentItems = hasToggle
    ? view === "previsto"
      ? itemsPrevisto
      : itemsExecutado
    : items;

  // Usa o currentItems para calcular o tamanho da barra
  const max = Math.max(...currentItems.map((i) => i.value), 1);

  return (
    <div className="bg-card dark:bg-zinc-900 rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800">
        <div>
          <h3 className="text-sm font-medium dark:font-medium text-foreground tracking-tight">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-zinc-400 dark:text-muted-foreground mt-0.5">
              {subtitle}
            </p>
          )}
        </div>

        {/* ✅ SELETOR (Só aparece se você passar os itemsPrevisto/itemsExecutado lá no page.tsx) */}
        {hasToggle && (
          <div className="flex bg-black/20 p-1 rounded-lg border border-border shrink-0">
            <button
              onClick={() => setView("previsto")}
              className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider rounded-md transition-all ${
                view === "previsto"
                  ? "bg-card dark:bg-zinc-800 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground/90 dark:hover:text-zinc-300"
              }`}
            >
              Previsto
            </button>
            <button
              onClick={() => setView("executado")}
              className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider rounded-md transition-all ${
                view === "executado"
                  ? "bg-card dark:bg-zinc-800 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground/90 dark:hover:text-zinc-300"
              }`}
            >
              Executado
            </button>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="px-5 py-4 space-y-3">
        {currentItems.length === 0 && (
          <p className="text-zinc-400 dark:text-muted-foreground text-sm py-2">
            Sem dados {view === "previsto" ? "previstos" : "executados"}.
          </p>
        )}

        {/* ✅ LER DE currentItems em vez de items direto */}
        {currentItems.map((item, idx) => {
          const pct = (item.value / max) * 100;
          const isTop = idx === 0;
          const barGrad = isTop ? c.topBar : c.bar;

          return (
            <div key={item.label} className="group">
              {/* Row */}
              <div className="flex items-center gap-3 mb-1.5">
                {/* Rank badge */}
                <div
                  className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${c.rankBg}`}
                >
                  {idx < 3 ? (
                    <span className="text-[13px] leading-none">
                      {medals[idx]}
                    </span>
                  ) : (
                    <span
                      className={`text-[10px] font-medium tabular-nums ${c.rank}`}
                    >
                      {idx + 1}
                    </span>
                  )}
                </div>

                {/* Label & Logo */}
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  {item.logo_url && (
                    <img
                      src={item.logo_url}
                      alt=""
                      className="w-5 h-5 rounded-md object-cover border border-border shrink-0"
                    />
                  )}
                  <span
                    className={`text-[13px] font-medium truncate ${c.label} group-hover:opacity-100`}
                    title={item.label}
                  >
                    {item.label}
                  </span>
                </div>

                {/* Value */}
                <span
                  className={`text-[13px] font-medium dark:font-normal tabular-nums flex-shrink-0 ${c.value}`}
                >
                  {fmt(item.value)}
                  {valueLabel && (
                    <span className="text-[10px] font-medium ml-1 opacity-60">
                      {valueLabel}
                    </span>
                  )}
                </span>
              </div>

              {/* Progress bar */}
              <div
                className={`relative h-1.5 rounded-full overflow-hidden ml-9 ${c.barBg}`}
              >
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
