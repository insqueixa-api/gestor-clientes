"use client";
// components/charts/ranking-card.tsx

import React, { useState } from "react";

type BarItem = {
  label: string;
  value: number;
  logo_url?: string | null;
};

// Meta (previsto) x progresso (executado) numa única barra por categoria
type ProgressItem = {
  label: string;
  previsto: number;
  executado: number;
  logo_url?: string | null;
  /** ✅ 17/10/2026: o que compõe a linha (passar o mouse / tocar) */
  details?: { label: string; value: string; note?: string; tone?: "ok" | "pending" | "extra" }[];
};

const DETAIL_TONE: Record<string, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  pending: "text-amber-600 dark:text-amber-400",
  extra: "text-sky-600 dark:text-sky-400",
};

type AccentColor = "sky" | "emerald" | "violet" | "rose" | "amber" | "indigo";

interface RankingCardProps {
  title: string;
  subtitle?: string;
  items?: BarItem[]; // ✅ Agora opcional
  itemsPrevisto?: BarItem[]; // ✅ Novo
  itemsAjustes?: BarItem[]; // ✅ Surgiu depois da fotografia do Previsto
  itemsExecutado?: BarItem[]; // ✅ Novo
  itemsProgress?: ProgressItem[]; // ✅ meta x progresso, uma barra só por linha
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

// Mesma paleta do card "Evolução Consolidada" (components/charts/evolucao-client.tsx):
// previsto = cinza esmaecido (só contexto), executado = cor cheia.
//
// ✅ Achado 26/08/2026 (pedido do Márcio): estourar o previsto usava uma
// cor âmbar fixa pra QUALQUER categoria — inclusive receita, onde estourar
// a meta é bom (vendeu mais que o esperado), não um alerta. Corrigido:
// "estourou" agora usa o tom mais forte/escuro da PRÓPRIA cor da categoria
// (accents[x].bar, já o tom mais escuro do degradê) — vermelho mais forte
// pra despesa, verde mais forte pra receita.
const PREVISTO_COLOR = "rgba(15,23,42,0.45)";

const accents: Record<
  AccentColor,
  {
    bar: string; // gradient para a barra
    barLight: string; // tom leve pro preenchimento de progresso
    barBg: string; // fundo da barra (track)
    execColor: string; // cor cheia do "Executado" (igual ao gráfico de evolução)
    rank: string; // cor do número de rank
    rankBg: string; // fundo do badge de rank
    dot: string; // cor do dot decorativo
    label: string; // cor do label
    value: string; // cor do valor
  }
> = {
  sky: {
    bar: "#075985",
    barLight: "#38bdf8",
    barBg: "bg-sky-500/20",
    execColor: "#0284c7",
    rank: "text-sky-500",
    rankBg: "bg-sky-500/10",
    dot: "bg-sky-400",
    label: "text-foreground/90",
    value: "text-sky-500",
  },
  emerald: {
    bar: "#065f46",
    barLight: "#34d399",
    barBg: "bg-emerald-500/20",
    execColor: "#059669",
    rank: "text-emerald-500",
    rankBg: "bg-emerald-500/10",
    dot: "bg-emerald-400",
    label: "text-foreground/90",
    value: "text-emerald-500",
  },
  violet: {
    bar: "#5b21b6",
    barLight: "#a78bfa",
    barBg: "bg-violet-500/20",
    execColor: "#7c3aed",
    rank: "text-violet-500",
    rankBg: "bg-violet-500/10",
    dot: "bg-violet-400",
    label: "text-foreground/90",
    value: "text-violet-500",
  },
  rose: {
    bar: "#9f1239",
    barLight: "#fb7185",
    barBg: "bg-rose-500/20",
    execColor: "#e11d48",
    rank: "text-rose-500",
    rankBg: "bg-rose-500/10",
    dot: "bg-rose-400",
    label: "text-foreground/90",
    value: "text-rose-500",
  },
  amber: {
    bar: "#92400e",
    barLight: "#fbbf24",
    barBg: "bg-amber-500/20",
    execColor: "#d97706",
    rank: "text-amber-500",
    rankBg: "bg-amber-500/10",
    dot: "bg-amber-400",
    label: "text-foreground/90",
    value: "text-amber-500",
  },
  indigo: {
    bar: "#4338ca",
    barLight: "#818cf8",
    barBg: "bg-indigo-500/20",
    execColor: "#4f46e5",
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
  itemsProgress,
  accentColor = "sky",
  valueLabel,
  formatValue,
  mode = "count",
}: RankingCardProps) {
  // ✅ Controle da visão ativa
  const [view, setView] = useState<"previsto" | "ajustes" | "executado">(
    "executado",
  );
  // linha com o resumo aberto (mouse em cima ou toque no celular)
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const defaultFormat = mode === "currency" ? fmtBRL : fmtInt;
  const fmt = formatValue ?? defaultFormat;
  const c = accents[accentColor];

  // ✅ meta (previsto) x progresso (executado) numa barra só, sem toggle
  const hasProgress = !!itemsProgress && itemsProgress.length > 0;

  // ✅ Se o componente receber as duas props do financeiro, ativa o toggle
  const hasToggle = !hasProgress && !!itemsPrevisto && !!itemsExecutado;
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
    <div className={`bg-card rounded-xl border border-border shadow-sm ${hasProgress ? "" : "overflow-hidden"}`}>
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between border-b border-border">
        <div>
          <h3 className="text-sm font-medium text-foreground tracking-tight">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
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
        {hasProgress ? (
          <>
            {itemsProgress!.length === 0 && (
              <p className="text-muted-foreground text-sm py-2">
                Sem dados no mês.
              </p>
            )}

            {itemsProgress!.map((item, idx) => {
              const scale = Math.max(item.previsto, item.executado, 1);
              const targetPct = (item.previsto / scale) * 100;
              const basePct =
                (Math.min(item.executado, item.previsto) / scale) * 100;
              const overPct =
                (Math.max(item.executado - item.previsto, 0) / scale) * 100;
              const isOver =
                item.executado > item.previsto && item.previsto > 0;

              const hasDetails = !!item.details?.length;
              const isOpen = hasDetails && openIdx === idx;

              return (
                <div
                  key={item.label}
                  className={`group relative ${hasDetails ? "cursor-pointer" : ""}`}
                  onMouseEnter={() => hasDetails && setOpenIdx(idx)}
                  onMouseLeave={() => setOpenIdx((cur) => (cur === idx ? null : cur))}
                  onClick={() => hasDetails && setOpenIdx((cur) => (cur === idx ? null : idx))}
                >
                  {isOpen && (
                    // pointer-events-none: o resumo nunca "segura" o mouse —
                    // descer pra próxima linha abre a dela na hora
                    <div
                      className={`pointer-events-none absolute left-9 right-0 z-30 rounded-lg border border-border bg-card shadow-xl px-2.5 py-2 ${
                        idx >= 3 ? "bottom-full mb-1" : "top-full mt-1"
                      }`}
                    >
                      <div className="space-y-0.5">
                        {item.details!.slice(0, 12).map((d, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 text-[11px] leading-5">
                            <span className="min-w-0 truncate">
                              <span className="text-foreground/90">{d.label}</span>
                              {d.note && <span className="text-muted-foreground"> · {d.note}</span>}
                            </span>
                            <span className={`shrink-0 tabular-nums font-medium ${DETAIL_TONE[d.tone ?? ""] ?? "text-muted-foreground"}`}>
                              {d.value}
                            </span>
                          </div>
                        ))}
                        {item.details!.length > 12 && (
                          <div className="text-[10px] text-muted-foreground">+{item.details!.length - 12} mais</div>
                        )}
                      </div>
                    </div>
                  )}
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
                      >
                        {item.label}
                      </span>
                    </div>

                    {/* Previsto (esmaecido) x Executado (cor cheia / âmbar se estourar) */}
                    <span className="text-[12px] tabular-nums flex-shrink-0 whitespace-nowrap">
                      <span style={{ color: PREVISTO_COLOR }}>
                        {fmt(item.previsto)} -{" "}
                      </span>
                      <span
                        className="font-medium"
                        style={{
                          color: isOver ? c.bar : c.execColor,
                        }}
                      >
                        {fmt(item.executado)}
                      </span>
                    </span>
                  </div>

                  {/* Progress bar: preenchimento leve até a meta, amarelo se ultrapassar */}
                  <div
                    className={`relative h-1.5 rounded-full overflow-hidden ml-9 ${c.barBg}`}
                  >
                    <div
                      className="absolute left-0 top-0 h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${basePct}%`,
                        background: c.barLight,
                      }}
                    />
                    {overPct > 0 && (
                      <div
                        className="absolute top-0 h-full transition-all duration-700"
                        style={{
                          left: `${basePct}%`,
                          width: `${overPct}%`,
                          background: c.bar,
                        }}
                      />
                    )}
                    {item.previsto > 0 && (
                      <div
                        className="absolute top-0 h-full w-px bg-foreground/30"
                        style={{ left: `${targetPct}%` }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
