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
  /** @deprecated Use colorVar instead */
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

/* ── Paletas ── */
const palettes = {
  blue: {
    barL: "linear-gradient(to top,#1e40af,#3b82f6,#93c5fd)",
    barD: "linear-gradient(to top,#1d4ed8,#60a5fa,#bfdbfe)",
    glowL:"rgba(59,130,246,0.22)",  glowHL:"rgba(59,130,246,0.42)",
    glowD:"rgba(96,165,250,0.45)",  glowHD:"rgba(96,165,250,0.75)",
    accL:"#2563eb",  accD:"#60a5fa",
    ringL:"rgba(59,130,246,0.5)",  ringD:"rgba(96,165,250,0.6)",
  },
  emerald: {
    barL: "linear-gradient(to top,#065f46,#059669,#6ee7b7)",
    barD: "linear-gradient(to top,#065f46,#34d399,#a7f3d0)",
    glowL:"rgba(5,150,105,0.18)",   glowHL:"rgba(5,150,105,0.38)",
    glowD:"rgba(52,211,153,0.4)",   glowHD:"rgba(52,211,153,0.7)",
    accL:"#059669",  accD:"#34d399",
    ringL:"rgba(5,150,105,0.5)",   ringD:"rgba(52,211,153,0.6)",
  },
  violet: {
    barL: "linear-gradient(to top,#4c1d95,#7c3aed,#c4b5fd)",
    barD: "linear-gradient(to top,#4c1d95,#a78bfa,#ede9fe)",
    glowL:"rgba(124,58,237,0.18)",  glowHL:"rgba(124,58,237,0.38)",
    glowD:"rgba(167,139,250,0.45)", glowHD:"rgba(167,139,250,0.75)",
    accL:"#7c3aed",  accD:"#a78bfa",
    ringL:"rgba(124,58,237,0.5)",  ringD:"rgba(167,139,250,0.6)",
  },
  rose: {
    barL: "linear-gradient(to top,#881337,#e11d48,#fda4af)",
    barD: "linear-gradient(to top,#881337,#fb7185,#ffe4e6)",
    glowL:"rgba(225,29,72,0.18)",   glowHL:"rgba(225,29,72,0.38)",
    glowD:"rgba(251,113,133,0.45)", glowHD:"rgba(251,113,133,0.75)",
    accL:"#e11d48",  accD:"#fb7185",
    ringL:"rgba(225,29,72,0.5)",   ringD:"rgba(251,113,133,0.6)",
  },
  amber: {
    barL: "linear-gradient(to top,#92400e,#d97706,#fcd34d)",
    barD: "linear-gradient(to top,#78350f,#fbbf24,#fef3c7)",
    glowL:"rgba(217,119,6,0.18)",   glowHL:"rgba(217,119,6,0.38)",
    glowD:"rgba(251,191,36,0.45)",  glowHD:"rgba(251,191,36,0.75)",
    accL:"#d97706",  accD:"#fbbf24",
    ringL:"rgba(217,119,6,0.5)",   ringD:"rgba(251,191,36,0.6)",
  },
};

/* ── Retrocompat ── */
function inferColorVar(colorClass?: string): keyof typeof palettes {
  if (!colorClass) return "blue";
  if (colorClass.includes("emerald")||colorClass.includes("green"))  return "emerald";
  if (colorClass.includes("violet")||colorClass.includes("purple")||colorClass.includes("indigo")) return "violet";
  if (colorClass.includes("rose")||colorClass.includes("red")||colorClass.includes("pink"))        return "rose";
  if (colorClass.includes("amber")||colorClass.includes("yellow")||colorClass.includes("orange"))  return "amber";
  return "blue";
}

/* ── Hook dark mode (respeita classe .dark do next-themes) ── */
function useIsDark() {
  const [dark, setDark] = React.useState(false);
  React.useEffect(() => {
    const check = () => setDark(document.documentElement.classList.contains("dark"));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
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
  const isDark = useIsDark();

  const cv = colorVar ?? inferColorVar(colorClass);
  const p  = palettes[cv];

  // aliases por tema
  const bar    = isDark ? p.barD  : p.barL;
  const glow   = isDark ? p.glowD : p.glowL;
  const glowH  = isDark ? p.glowHD: p.glowHL;
  const acc    = isDark ? p.accD  : p.accL;
  const ring   = isDark ? p.ringD : p.ringL;

  // cores de superfície
  const bg1        = isDark ? "rgba(15,23,42,0.97)"   : "rgba(249,250,251,1)";
  const bg2        = isDark ? "rgba(9,14,28,1)"        : "rgba(241,245,249,1)";
  const border     = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const borderY    = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)";
  const gridSolid  = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.09)";
  const gridDash   = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
  const tickCol    = isDark ? "rgba(148,163,184,0.55)" : "rgba(71,85,105,0.65)";
  const lblCol     = isDark ? "rgba(148,163,184,0.50)" : "rgba(71,85,105,0.55)";
  const zeroBar    = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)";
  const tipBg      = isDark ? "rgba(15,23,42,0.96)"   : "rgba(255,255,255,0.97)";
  const tipText    = isDark ? "rgba(226,232,240,0.9)"  : "rgba(15,23,42,0.85)";
  const sheenAlpha = isDark ? "0.28" : "0.45";

  const { maxNice, ticks } = useMemo(() => {
    const rawMax = Math.max(...data.map((d) => d.value), 0);
    const maxNice = niceCeil(rawMax || 1);
    return { maxNice, ticks: Array.from({ length: 5 }, (_, i) => (maxNice * i) / 4) };
  }, [data]);

  const xEvery = data.length <= 8 ? 1 : data.length <= 16 ? 2 : data.length <= 24 ? 3 : 4;
  const hoveredItem = hoveredIdx != null ? data[hoveredIdx] : null;

  const handleMouseMove = (e: React.MouseEvent, idx: number) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoveredIdx(idx);
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleTouchStart = (e: React.TouchEvent, idx: number) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) return;
    const t = e.touches[0];
    setHoveredIdx((cur) => (cur === idx ? null : idx));
    setTooltipPos({ x: t.clientX - rect.left, y: t.clientY - rect.top });
  };

  const TIP_W = 200;
  const tipLeft = Math.min(Math.max(tooltipPos.x - TIP_W / 2, 6), (chartRef.current?.clientWidth ?? 800) - TIP_W - 6);
  const tipTop  = tooltipPos.y - 66;

  return (
    <div className="w-full select-none">
      <div
        ref={chartRef}
        className={`relative w-full ${heightClass}`}
        style={{
          background: `linear-gradient(160deg,${bg1} 0%,${bg2} 100%)`,
          borderRadius: "0.875rem",
          border: `1px solid ${border}`,
          boxShadow: isDark
            ? "0 4px 6px -1px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.04)"
            : "0 1px 3px rgba(0,0,0,.07),0 1px 2px rgba(0,0,0,.04),inset 0 1px 0 rgba(255,255,255,.9)",
          overflow: "visible",
        }}
      >
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ borderRadius: "0.875rem", display: "grid", gridTemplateColumns: "44px 1fr" }}
        >
          {/* Y axis */}
          <div className="relative" style={{ borderRight: `1px solid ${borderY}` }}>
            {ticks.map((t, i) => (
              <div key={i} className="absolute left-0 w-full" style={{ bottom: `calc(${(i/4)*100}% + 1.75rem)` }}>
                <span className="absolute right-2 tabular-nums leading-none"
                  style={{ fontSize:"9px", color:tickCol, transform:"translateY(50%)" }}>
                  {mode==="currency" ? (t===0?"0":t>=1000?`${Math.round(t/1000)}k`:Math.round(t)) : Math.round(t)}
                </span>
              </div>
            ))}
          </div>

          {/* bars area */}
          <div className="relative px-3 pt-3 pb-7">
            {ticks.map((_, i) => (
              <div key={i} className="pointer-events-none absolute left-0 right-0"
                style={{ bottom:`calc(${(i/4)*100}% + 1.75rem)`, borderTop:`1px ${i===0?"solid":"dashed"} ${i===0?gridSolid:gridDash}` }} />
            ))}

            <div className="h-full flex items-end gap-[3px] relative">
              {data.map((item, idx) => {
                const pct    = maxNice > 0 ? (item.value / maxNice) * 100 : 0;
                const isZero = item.value <= 0;
                const isH    = hoveredIdx === idx;
                return (
                  <button key={idx} type="button"
                    onMouseMove={(e) => !isZero && handleMouseMove(e, idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    onTouchStart={(e) => !isZero && handleTouchStart(e, idx)}
                    disabled={isZero}
                    className="relative flex-1 h-full flex items-end"
                    style={{ cursor: isZero?"default":"pointer" }}
                    aria-label={`${label??"valor"}: ${item.displayValue}`}
                  >
                    {/* glow */}
                    {!isZero && (
                      <div className="absolute bottom-0 left-0 right-0 rounded-full"
                        style={{ height:`${pct*0.55}%`, background:isH?glowH:glow, filter:"blur(7px)", opacity:isH?1:0.6, transition:"opacity .2s,background .2s", zIndex:0 }} />
                    )}
                    {/* bar */}
                    <div className="relative w-full rounded-t-md"
                      style={{
                        height: isZero?"2px":`${pct}%`,
                        background: isZero?zeroBar:bar,
                        transition:"height .5s cubic-bezier(.22,.68,0,1.2),box-shadow .2s,opacity .2s",
                        opacity: isZero?.3:isH?1:.86,
                        boxShadow: isH?`0 0 12px 2px ${ring},inset 0 1px 0 rgba(255,255,255,${sheenAlpha})`:`inset 0 1px 0 rgba(255,255,255,${sheenAlpha})`,
                        zIndex:1,
                      }}
                    >
                      {!isZero && (
                        <div className="absolute top-0 left-0 right-0 h-[5px] rounded-t-md"
                          style={{ background:`linear-gradient(to bottom,rgba(255,255,255,${sheenAlpha}),transparent)` }} />
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
                    {i % xEvery === 0
                      ? <span style={{ fontSize:"9px", color:hoveredIdx===i?acc:lblCol, fontVariantNumeric:"tabular-nums", transition:"color .15s", display:"block", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{d.label}</span>
                      : <div className="h-3" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Tooltip */}
        {hoveredItem && (
          <div className="pointer-events-none absolute z-50"
            style={{ left:tipLeft, top:tipTop<0?tooltipPos.y+12:tipTop, width:TIP_W }}>
            <div style={{
              background:tipBg, backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)",
              border:`1px solid ${acc}44`, borderRadius:"10px", padding:"8px 12px",
              boxShadow:isDark?"0 8px 24px rgba(0,0,0,.5)":"0 4px 16px rgba(0,0,0,.12)",
            }}>
              <div className="font-semibold truncate" style={{ fontSize:"11px", color:acc }}>{hoveredItem.tooltipTitle}</div>
              <div className="truncate mt-0.5" style={{ fontSize:"12px", color:tipText }}>{hoveredItem.tooltipContent}</div>
            </div>
            <div style={{
              position:"absolute", bottom:tipTop<0?"auto":"-5px", top:tipTop<0?"-5px":"auto",
              left:"50%", transform:`translateX(-50%) rotate(${tipTop<0?"180deg":"0deg"})`,
              width:0, height:0, borderLeft:"5px solid transparent", borderRight:"5px solid transparent",
              borderTop:`5px solid ${acc}44`,
            }} />
          </div>
        )}
      </div>
    </div>
  );
}
