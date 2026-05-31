"use client";

import React, { useEffect, useState, useMemo } from "react";
import type { MonthData } from "./evolucao-chart";

function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const check = () => setDark(document.documentElement.classList.contains("dark"));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

function fmtAxis(v: number): string {
  if (v === 0) return "0";
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return String(Math.round(v));
}

function fmtCell(v: number): string {
  if (v === 0) return "—";
  if (v >= 1_000_000) return `R$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)    return `R$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL", maximumFractionDigits: 0,
  }).format(v);
}

type RowDef = {
  label: string;
  key: "bar1" | "line1" | "bar2" | "line2";
  dot: string;
  lightColor: string;
  darkColor: string;
  bold: boolean;
  rowBg?: string;
};

export function EvolucaoFinanceiraClient({ data }: { data: MonthData[] }) {
  const [isMobile, setIsMobile] = useState(false);
  const isDark = useIsDark();

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const sliced = isMobile ? data.slice(-6) : data;
  const n = sliced.length;

  // ── Layout: shared between SVG chart and table ───────────────────
  // LABEL_W = chart paddingLeft = table first-column width → they align perfectly
  const LABEL_W = 148;
  const COL_W   = 84;   // chart stepX = table cell width → columns align perfectly
  const PAD_R   = 8;
  const CHART_H = 232;
  const PAD_T   = 14;
  const PAD_B   = 28;
  const INNER_W = LABEL_W + n * COL_W + PAD_R;
  const DRAW_H  = CHART_H - PAD_T - PAD_B;

  // ── Y scale ──────────────────────────────────────────────────────
  const maxVal = useMemo(() => {
    let m = 0;
    sliced.forEach(d => { m = Math.max(m, d.bar1, d.bar2, d.line1, d.line2); });
    if (m <= 0) return 1000;
    const exp = Math.pow(10, Math.floor(Math.log10(m)));
    const f   = m / exp;
    const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return Math.ceil(nice * exp);
  }, [sliced]);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map(r => Math.round(maxVal * r));

  // X/Y helpers — getX(i) centers on the exact same position as each table cell
  const getX = (i: number) => LABEL_W + i * COL_W + COL_W / 2;
  const getY = (v: number) => CHART_H - PAD_B - (v / maxVal) * DRAW_H;

  // ── Colors ───────────────────────────────────────────────────────
  const BG   = isDark ? "#18212f" : "#ffffff";
  const GRID = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const TICK = isDark ? "rgba(148,163,184,0.65)" : "rgba(71,85,105,0.65)";
  const BAR1 = "rgba(16,185,129,0.2)";
  const BAR2 = "rgba(244,63,94,0.2)";
  const L1   = isDark ? "#34d399" : "#10b981";
  const L2   = isDark ? "#fb7185" : "#e11d48";
  const BAR_W = Math.min(COL_W * 0.27, 20);

  const makePath = (key: "line1" | "line2") =>
    sliced
      .map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)} ${getY(d[key]).toFixed(1)}`)
      .join(" ");

  // ── Table rows ───────────────────────────────────────────────────
  const rows: (RowDef | "divider")[] = [
    {
      label: "Receita Prevista", key: "bar1",
      dot: "#86efac", lightColor: "#15803d", darkColor: "#4ade80",
      bold: false,
      rowBg: isDark ? "rgba(16,185,129,0.035)" : "rgba(16,185,129,0.04)",
    },
    {
      label: "Receita Executada", key: "line1",
      dot: "#16a34a", lightColor: "#166534", darkColor: "#34d399",
      bold: true,
    },
    "divider",
    {
      label: "Despesa Prevista", key: "bar2",
      dot: "#fca5a5", lightColor: "#dc2626", darkColor: "#f87171",
      bold: false,
      rowBg: isDark ? "rgba(244,63,94,0.035)" : "rgba(244,63,94,0.04)",
    },
    {
      label: "Despesa Executada", key: "line2",
      dot: "#dc2626", lightColor: "#7f1d1d", darkColor: "#fb7185",
      bold: true,
    },
  ];

  const BORDER  = isDark ? "rgba(255,255,255,0.055)" : "rgba(0,0,0,0.055)";
  const DIVIDER = isDark ? "rgba(255,255,255,0.1)"   : "rgba(0,0,0,0.1)";

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">

      {/* Header */}
      <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-zinc-100 dark:border-zinc-800">
        <h3 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100">
          Evolução Consolidada{" "}
          <span className="font-normal text-zinc-400 dark:text-zinc-500 text-xs">
            ({n} meses)
          </span>
        </h3>
        <div className="flex items-center gap-5 mt-1.5">
          <span className="flex items-center gap-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: BAR1, border: "1px solid rgba(16,185,129,0.5)" }} />
            <span className="w-2.5 h-2.5 rounded-sm inline-block -ml-1.5" style={{ background: BAR2, border: "1px solid rgba(244,63,94,0.5)" }} />
            Barras: Previsto
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
            <svg width="20" height="7" viewBox="0 0 20 7">
              <path d="M0 3.5 L20 3.5" stroke={L1} strokeWidth="2" strokeLinecap="round" />
              <circle cx="10" cy="3.5" r="2.2" fill={BG} stroke={L1} strokeWidth="1.8" />
            </svg>
            <svg width="20" height="7" viewBox="0 0 20 7" className="-ml-1.5">
              <path d="M0 3.5 L20 3.5" stroke={L2} strokeWidth="2" strokeLinecap="round" />
              <circle cx="10" cy="3.5" r="2.2" fill={BG} stroke={L2} strokeWidth="1.8" />
            </svg>
            Linhas: Executado
          </span>
        </div>
      </div>

      {/* ── Single scrollable container: chart + table scroll together ── */}
      <div className="overflow-x-auto">
        <div style={{ width: INNER_W }}>

          {/* SVG Chart */}
          <svg
            width={INNER_W}
            height={CHART_H}
            viewBox={`0 0 ${INNER_W} ${CHART_H}`}
            style={{ display: "block" }}
          >
            {/* Grid lines + Y-axis labels */}
            {ticks.map((t, i) => {
              const y = getY(t);
              return (
                <g key={i}>
                  <line
                    x1={LABEL_W} y1={y} x2={INNER_W - PAD_R} y2={y}
                    stroke={GRID} strokeWidth="1"
                    strokeDasharray={i === 0 ? "none" : "4 3"}
                  />
                  <text
                    x={LABEL_W - 7} y={y + 3.5}
                    fontSize="9" fill={TICK} textAnchor="end"
                    fontFamily="system-ui,sans-serif"
                  >
                    {fmtAxis(t)}
                  </text>
                </g>
              );
            })}

            {/* Bars + X-axis labels */}
            {sliced.map((d, i) => {
              const cx = getX(i);
              const y0 = CHART_H - PAD_B;
              const yB1 = getY(d.bar1); const hB1 = Math.max(0, y0 - yB1);
              const yB2 = getY(d.bar2); const hB2 = Math.max(0, y0 - yB2);
              return (
                <g key={i}>
                  {hB1 > 0 && <rect x={cx - BAR_W - 1} y={yB1} width={BAR_W} height={hB1} fill={BAR1} rx="2" />}
                  {hB2 > 0 && <rect x={cx + 1}          y={yB2} width={BAR_W} height={hB2} fill={BAR2} rx="2" />}
                  <text
                    x={cx} y={y0 + 18}
                    fontSize="9.5" fill={TICK} textAnchor="middle"
                    fontFamily="system-ui,sans-serif" fontWeight="600"
                  >
                    {d.label}
                  </text>
                </g>
              );
            })}

            {/* Glow */}
            <path d={makePath("line1")} fill="none" stroke={L1} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.12" style={{ filter: "blur(3px)" }} />
            <path d={makePath("line2")} fill="none" stroke={L2} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" opacity="0.12" style={{ filter: "blur(3px)" }} />

            {/* Lines */}
            <path d={makePath("line1")} fill="none" stroke={L1} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d={makePath("line2")} fill="none" stroke={L2} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

            {/* Dots */}
            {sliced.map((d, i) => (
              <g key={`pts-${i}`}>
                <circle cx={getX(i)} cy={getY(d.line1)} r="3" fill={BG} stroke={L1} strokeWidth="2" />
                <circle cx={getX(i)} cy={getY(d.line2)} r="3" fill={BG} stroke={L2} strokeWidth="2" />
              </g>
            ))}
          </svg>

          {/* ── Table — widths mirror chart exactly ── */}
          <div style={{ borderTop: `1px solid ${DIVIDER}` }}>
            {rows.map((row, ri) => {
              if (row === "divider") {
                return <div key={`div-${ri}`} style={{ height: 1, background: DIVIDER }} />;
              }

              const labelColor = row.bold
                ? (isDark ? row.darkColor : row.lightColor)
                : TICK;
              const valColor = (val: number) =>
                val === 0
                  ? isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)"
                  : row.bold
                    ? (isDark ? row.darkColor : row.lightColor)
                    : TICK;

              return (
                <div
                  key={row.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    background: row.rowBg ?? "transparent",
                    borderBottom: `1px solid ${BORDER}`,
                  }}
                >
                  {/* Label cell — width = LABEL_W (= chart paddingLeft) */}
                  <div style={{
                    width: LABEL_W, minWidth: LABEL_W,
                    paddingLeft: 14, paddingRight: 6,
                    paddingTop: 7, paddingBottom: 7,
                    display: "flex", alignItems: "center", gap: 7,
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: row.dot, flexShrink: 0 }} />
                    <span style={{
                      fontSize: 10.5,
                      fontWeight: row.bold ? 800 : 500,
                      color: labelColor,
                      whiteSpace: "nowrap",
                    }}>
                      {row.label}
                    </span>
                  </div>

                  {/* Data cells — width = COL_W (= chart stepX) */}
                  {sliced.map((d, ci) => {
                    const val = d[row.key];
                    return (
                      <div
                        key={ci}
                        style={{
                          width: COL_W, minWidth: COL_W,
                          textAlign: "center",
                          paddingTop: 7, paddingBottom: 7,
                          fontSize: 10.5,
                          fontWeight: row.bold ? 800 : 500,
                          color: valColor(val),
                          fontVariantNumeric: "tabular-nums",
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {fmtCell(val)}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

        </div>
      </div>

      <div style={{ height: 8 }} />
    </div>
  );
}
