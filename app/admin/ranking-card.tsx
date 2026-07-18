"use client";
// app/admin/ranking-card.tsx

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
  itemsAjustes?: BarItem[]; // ✅ Surgiu depois da fotografia do Previsto
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
  }
> = {
  sky: {
    bar: "#075985",
    barBg: "bg-sky-500/20",
    rank: "text-sky-500",
    rankBg: "bg-sky-500/10",
    dot: "bg-sky-400",
    label: "text-foreground/90",
    value: "text-sky-500",
  },
  emerald: {
    bar: "#065f46",
    barBg: "bg-emerald-500/20",
    rank: "text-emerald-500",
    rankBg: "bg-emerald-500/10",
    dot: "bg-emerald-400",
    label: "text-foreground/90",
    value: "text-emerald-500",
  },
  violet: {
    bar: "#5b21b6",
    barBg: "bg-violet-500/20",
    rank: "text-violet-500",
    rankBg: "bg-violet-500/10",
    dot: "bg-violet-400",
    label: "text-foreground/90",
    value: "text-violet-500",
  },
  rose: {
    bar: "#9f1239",
    barBg: "bg-rose-500/20",
    rank: "text-rose-500",
    rankBg: "bg-rose-500/10",
    dot: "bg-rose-400",
    label: "text-foreground/90",
    value: "text-rose-500",
  },
  amber: {
    bar: "#92400e",
    barBg: "bg-amber-500/20",
    rank: "text-amber-500",
    rankBg: "bg-amber-500/10",
    dot: "bg-amber-400",
    label: "text-foreground/90",
    value: "text-amber-500",
  },
  indigo: {
    bar: "#4338ca",
    barBg: "bg-indigo-500/20",
    rank: "text-indigo-500",
    rankBg: "bg-indigo-500/10",
    dot: "bg-indigo-400",
    label: "text-foreground/90",
    value: "text-indigo-500",
  },
};

const medals = ["🥇", "🥈", "🥉"];

export function RankingCard({
  title,
  subtitle,
  items = [],
  itemsPrevisto,
  itemsAjustes,
  itemsExecutado,
  accentColor = "sky",
  valueLabel,
  formatValue,
  mode = "count",
}: RankingCardProps) {
  // ✅ Controle da visão ativa
  const [view, setView] = useState<"previsto" | "ajustes" | "executado">(
    "executado",
  );

  const defaultFormat = mode === "currency" ? fmtBRL : fmtInt;
  const fmt = formatValue ?? defaultFormat;
  const c = accents[accentColor];

  // ✅ Se o componente receber as duas props do financeiro, ativa o toggle
  const hasToggle = !!itemsPrevisto && !!itemsExecutado;
  const hasAjustes = !!itemsAjustes && itemsAjustes.length > 0;

  // ✅ Define qual array de dados usar (O selecionado ou o padrão)
  const currentItems = hasToggle
    ? view === "previsto"
      ? itemsPrevisto
      : view === "ajustes"
        ? (itemsAjustes ?? [])
        : itemsExecutado
    : items;

  // Usa o currentItems para calcular o tamanho da barra
  const max = Math.max(...currentItems.map((i) => i.value), 1);

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between border-b border-border">
        <div>
<h3 className="text-sm font-medium text-foreground tracking-tight">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {subtitle}
            </p>
          )}
        </div>

        {/* ✅ SELETOR (Só aparece se você passar os itemsPrevisto/itemsExecutado lá no page.tsx) */}
        {hasToggle && (
<div className="flex bg-transparent p-1 rounded-lg border border-border shrink-0">
            <button
              onClick={() => setView("previsto")}
              className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider rounded-md transition-all ${
                view === "previsto"
                  ? "bg-muted text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground/90"
              }`}
            >
              Previsto
            </button>
            {hasAjustes && (
              <button
                onClick={() => setView("ajustes")}
                className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider rounded-md transition-all ${
                  view === "ajustes"
                    ? "bg-muted text-foreground shadow-sm"
                    : "text-amber-500 hover:text-amber-400"
                }`}
              >
                Ajustes
              </button>
            )}
            <button
              onClick={() => setView("executado")}
              className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider rounded-md transition-all ${
                view === "executado"
                  ? "bg-muted text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground/90"
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
          <p className="text-muted-foreground text-sm py-2">
            Sem dados{" "}
            {view === "previsto"
              ? "previstos"
              : view === "ajustes"
                ? "de ajustes"
                : "executados"}
            .
          </p>
        )}

        {/* ✅ LER DE currentItems em vez de items direto */}
        {currentItems.map((item, idx) => {
          const pct = (item.value / max) * 100;

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
                  className={`text-[13px] font-medium tabular-nums flex-shrink-0 ${c.value}`}
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
                    background: c.bar,
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
