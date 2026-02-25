"use client";

import React, { useMemo, useRef, useState } from "react";

export type SimpleBarChartDatum = {
  label: string;
  value: number;
  displayValue: number;
  tooltipTitle: string;
  tooltipContent: string;
};

interface SimpleBarChartProps {
  data: SimpleBarChartDatum[];
  mode?: "count" | "currency";
  colorVar?: "blue" | "emerald" | "violet" | "rose" | "amber";
  /** @deprecated Usar colorVar no lugar. Mantido para retrocompatibilidade. */
  colorClass?: string;
  label?: string;
  heightClass?: string;
}

/* ── Formatadores ─────────────────────────────── */
const fmtInt = (v: number) => new Intl.NumberFormat("pt-BR").format(v);
const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(v);

/* ── Nice scale ───────────────────────────────── */
function niceCeil(n: number) {
  if (n <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(n)));
  const f = n / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/* ── Paletas ──────────────────────────────────── */
const palettes = {
  blue: {
    bar: "linear-gradient(to top, #1d4ed8, #60a5fa, #bfdbfe)",
    glow: "rgba(96,165,250,0.45)",
    glowHover: "rgba(96,165,250,0.75)",
    accent: "#60a5fa",
    ring: "rgba(96,165,250,0.6)",
  },
  emerald: {
    bar: "linear-gradient(to top, #065f46, #34d399, #a7f3d0)",
    glow: "rgba(52,211,153,0.4)",
    glowHover: "rgba(52,211,153,0.7)",
    accent: "#34d399",
    ring: "rgba(52,211,153,0.6)",
  },
  violet: {
    bar: "linear-gradient(to top, #4c1d95, #a78bfa, #ede9fe)",
    glow: "rgba(167,139,250,0.45)",
    glowHover: "rgba(167,139,250,0.75)",
    accent: "#a78bfa",
    ring: "rgba(167,139,250,0.6)",
  },
  rose: {
    bar: "linear-gradient(to top, #881337, #fb7185, #ffe4e6)",
    glow: "rgba(251,113,133,0.45)",
    glowHover: "rgba(251,113,133,0.75)",
    accent: "#fb7185",
    ring: "rgba(251,113,133,0.6)",
  },
  amber: {
    bar: "linear-gradient(to top, #78350f, #fbbf24, #fef3c7)",
    glow: "rgba(251,191,36,0.45)",
    glowHover: "rgba(251,191,36,0.75)",
    accent: "#fbbf24",
    ring: "rgba(251,191,36,0.6)",
  },
};

/* ── Mapeamento retrocompatível colorClass → colorVar ── */
function inferColorVar(colorClass?: string): keyof typeof palettes {
  if (!colorClass) return "blue";
  if (colorClass.includes("emerald") || colorClass.includes("green"))               return "emerald";
  if (colorClass.includes("violet") || colorClass.includes("purple") || colorClass.includes("indigo")) return "violet";
  if (colorClass.includes("rose")   || colorClass.includes("red")    || colorClass.includes("pink"))   return "rose";
  if (colorClass.includes("amber")  || colorClass.includes("yellow") || colorClass.includes("orange")) return "amber";
  return "blue";
}

/* ══════════════════════════════════════════════
   COMPONENTE PRINCIPAL
══════════════════════════════════════════════ */
export function SimpleBarChart({
  data,
  mode = "count",
  colorVar,
  colorClass,
  label,
  heightClass = "h-56",
}: SimpleBarChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const chartRef = useRef<HTMLDivElement>(null);

  // colorVar tem prioridade; se não informado, tenta inferir pelo colorClass legado
  const resolvedColorVar = colorVar ?? inferColorVar(colorClass);
  const palette = palettes[resolvedColorVar];

  const { maxNice, ticks } = useMemo(() => {
    const rawMax = Math.max(...data.map((d) => d.value), 0);
    const maxNice = niceCeil(rawMax || 1);
    const ticks = Array.from({ length: 5 }, (_, i) => (maxNice * i) / 4);
    return { maxNice, ticks };
  }, [data]);

  const formatY = (v: number) => (mode === "currency" ? fmtBRL(v) : fmtInt(v));

  const xEvery =
    data.length <= 8 ? 1 : data.length <= 16 ? 2 : data.length <= 24 ? 3 : 4;

  const hoveredItem = hoveredIdx != null ? data[hoveredIdx] : null;

  const handleMouseMove = (e: React.MouseEvent, idx: number) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoveredIdx(idx);
    setTooltipPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleTouchStart = (e: React.TouchEvent, idx: number) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) return;
    const touch = e.touches[0];
    setHoveredIdx((cur) => (cur === idx ? null : idx));
    setTooltipPos({
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    });
  };

  /* ── Tooltip position: clamp to chart bounds ── */
  const TIP_W = 180;
  const TIP_H = 52;
  const tipLeft = Math.min(
    Math.max(tooltipPos.x - TIP_W / 2, 6),
    (chartRef.current?.clientWidth ?? 800) - TIP_W - 6
  );
  const tipTop = tooltipPos.y - TIP_H - 12;

  return (
    <div className="w-full select-none">
      {/* ── CHART WRAPPER ───────────────────────── */}
      <div
        ref={chartRef}
        className={`relative w-full ${heightClass}`}
        style={{
          background:
            "linear-gradient(160deg,rgba(15,23,42,0.97) 0%,rgba(9,14,28,1) 100%)",
          borderRadius: "1rem",
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow:
            "0 4px 6px -1px rgba(0,0,0,0.5),0 2px 4px -2px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
          overflow: "visible",
        }}
      >
        {/* subtle noise grain overlay */}
        <div
          className="pointer-events-none absolute inset-0 rounded-2xl opacity-[0.025]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
            backgroundSize: "128px 128px",
          }}
        />

        {/* ── GRID + BARS ─────────────────────── */}
        <div className="absolute inset-0 grid grid-cols-[44px_1fr] rounded-2xl overflow-hidden">
          {/* Y axis */}
          <div className="relative" style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}>
            {ticks.map((t, i) => {
              const pct = (i / 4) * 100;
              return (
                <div
                  key={i}
                  className="absolute left-0 w-full"
                  style={{ bottom: `calc(${pct}% + 1.75rem)` }}
                >
                  <span
                    className="absolute right-2 tabular-nums leading-none"
                    style={{
                      fontSize: "9px",
                      color: "rgba(148,163,184,0.55)",
                      transform: "translateY(50%)",
                    }}
                  >
                    {mode === "currency"
                      ? t === 0
                        ? "0"
                        : t >= 1000
                        ? `${Math.round(t / 1000)}k`
                        : Math.round(t)
                      : Math.round(t)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* bars area */}
          <div className="relative px-3 pt-3 pb-7">
            {/* grid lines */}
            {ticks.map((_, i) => {
              const pct = (i / 4) * 100;
              return (
                <div
                  key={i}
                  className="pointer-events-none absolute left-0 right-0"
                  style={{
                    bottom: `calc(${pct}% + 1.75rem)`,
                    borderTop:
                      i === 0
                        ? "1px solid rgba(255,255,255,0.1)"
                        : "1px dashed rgba(255,255,255,0.05)",
                  }}
                />
              );
            })}

            {/* bars */}
            <div className="h-full flex items-end gap-[3px] relative">
              {data.map((item, idx) => {
                const pct = maxNice > 0 ? (item.value / maxNice) * 100 : 0;
                const isZero = item.value <= 0;
                const isHovered = hoveredIdx === idx;

                return (
                  <button
                    key={idx}
                    type="button"
                    onMouseMove={(e) => !isZero && handleMouseMove(e, idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    onTouchStart={(e) => !isZero && handleTouchStart(e, idx)}
                    disabled={isZero}
                    className="relative flex-1 h-full flex items-end"
                    style={{ cursor: isZero ? "default" : "pointer" }}
                    aria-label={`${label ?? "valor"}: ${item.displayValue}`}
                  >
                    {/* glow bloom behind bar */}
                    {!isZero && (
                      <div
                        className="absolute bottom-0 left-0 right-0 rounded-full"
                        style={{
                          height: `${pct * 0.6}%`,
                          background: isHovered ? palette.glowHover : palette.glow,
                          filter: "blur(8px)",
                          opacity: isHovered ? 1 : 0.5,
                          transition: "opacity 0.2s, background 0.2s",
                          zIndex: 0,
                        }}
                      />
                    )}

                    {/* bar itself */}
                    <div
                      className="relative w-full rounded-t-md"
                      style={{
                        height: isZero ? "3px" : `${pct}%`,
                        background: isZero
                          ? "rgba(255,255,255,0.08)"
                          : palette.bar,
                        transition:
                          "height 0.5s cubic-bezier(.22,.68,0,1.2), box-shadow 0.2s, opacity 0.2s",
                        opacity: isZero ? 0.25 : isHovered ? 1 : 0.82,
                        boxShadow: isHovered
                          ? `0 0 14px 2px ${palette.ring}, inset 0 1px 0 rgba(255,255,255,0.3)`
                          : `0 0 0 transparent, inset 0 1px 0 rgba(255,255,255,0.15)`,
                        zIndex: 1,
                      }}
                    >
                      {/* top sheen */}
                      {!isZero && (
                        <div
                          className="absolute top-0 left-0 right-0 h-[6px] rounded-t-md"
                          style={{
                            background:
                              "linear-gradient(to bottom,rgba(255,255,255,0.35),transparent)",
                          }}
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* X axis */}
            <div className="absolute left-0 right-0 bottom-0 px-3 pb-[6px]">
              <div className="flex gap-[3px]">
                {data.map((d, i) => (
                  <div key={i} className="flex-1 text-center overflow-hidden">
                    {i % xEvery === 0 ? (
                      <span
                        style={{
                          fontSize: "9px",
                          color:
                            hoveredIdx === i
                              ? palette.accent
                              : "rgba(148,163,184,0.5)",
                          fontVariantNumeric: "tabular-nums",
                          transition: "color 0.15s",
                          display: "block",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {d.label}
                      </span>
                    ) : (
                      <div className="h-3" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── FLOATING TOOLTIP ────────────────── */}
        {hoveredItem && (
          <div
            className="pointer-events-none absolute z-50"
            style={{
              left: tipLeft,
              top: tipTop < 0 ? tooltipPos.y + 14 : tipTop,
              width: TIP_W,
            }}
          >
            <div
              style={{
                background: "rgba(15,23,42,0.92)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                border: `1px solid ${palette.accent}44`,
                borderRadius: "10px",
                padding: "8px 12px",
                boxShadow: `0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)`,
              }}
            >
              <div
                className="font-semibold truncate"
                style={{ fontSize: "11px", color: palette.accent }}
              >
                {hoveredItem.tooltipTitle}
              </div>
              <div
                className="truncate mt-0.5"
                style={{ fontSize: "12px", color: "rgba(226,232,240,0.9)" }}
              >
                {hoveredItem.tooltipContent}
              </div>
            </div>
            {/* arrow */}
            <div
              style={{
                position: "absolute",
                bottom: tipTop < 0 ? "auto" : "-5px",
                top: tipTop < 0 ? "-5px" : "auto",
                left: "50%",
                transform: `translateX(-50%) rotate(${tipTop < 0 ? "180deg" : "0deg"})`,
                width: 0,
                height: 0,
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderTop: `5px solid ${palette.accent}44`,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
