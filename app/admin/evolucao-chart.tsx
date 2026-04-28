"use client";

import React, { useMemo, useRef, useState, useEffect } from "react";

export type MixedChartDatum = {
  label: string;
  bar1?: number; // Previsão Receita (Barra Verde clara)
  bar2?: number; // Previsão Despesa (Barra Vermelha clara)
  line1?: number; // Executado Receita (Linha Verde forte)
  line2?: number; // Executado Despesa (Linha Vermelha forte)
  tooltipTitle: string;
  tooltipContent: React.ReactNode;
};

interface MixedChartProps {
  data: MixedChartDatum[];
  heightClass?: string;
  formatValue?: (v: number) => string;
}

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

/* ── Paletas Fixas ── */
const palRev = {
  barL: "linear-gradient(to top,#065f46,#059669,#6ee7b7)",
  barD: "linear-gradient(to top,#065f46,#34d399,#a7f3d0)",
  glowL: "rgba(5,150,105,0.18)",  glowHL: "rgba(5,150,105,0.45)",
  lineL: "#10b981", lineD: "#34d399"
};

const palExp = {
  barL: "linear-gradient(to top,#881337,#e11d48,#fda4af)",
  barD: "linear-gradient(to top,#881337,#fb7185,#ffe4e6)",
  glowL: "rgba(225,29,72,0.18)",  glowHL: "rgba(225,29,72,0.45)",
  lineL: "#f43f5e", lineD: "#fb7185"
};

export default function MixedChart({ data, heightClass = "h-80", formatValue }: MixedChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const chartRef = useRef<HTMLDivElement>(null);
  
  const isDark = useIsDark();

  // Escala Máxima e Ticks (Eixo Y)
  const { maxNice, ticks } = useMemo(() => {
    let rawMax = 0;
    data.forEach(d => {
      rawMax = Math.max(rawMax, d.bar1 || 0, d.bar2 || 0, d.line1 || 0, d.line2 || 0);
    });
    const niceCeil = (n: number) => {
      if (n <= 0) return 1;
      const exp = Math.pow(10, Math.floor(Math.log10(n)));
      const f = n / exp;
      const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
      return nice * exp;
    };
    const max = niceCeil(rawMax || 1);
    return { maxNice: max, ticks: Array.from({ length: 5 }, (_, i) => (max * i) / 4) };
  }, [data]);

  const fmt = formatValue || ((v: number) => {
    if (v === 0) return "0";
    return v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v));
  });

  const handleMouseMove = (e: React.MouseEvent, idx: number) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHoveredIdx(idx);
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const handleMouseLeave = () => setHoveredIdx(null);

  const hoveredItem = hoveredIdx !== null ? data[hoveredIdx] : null;

  // ── CORES BASEADAS NO TEMA ──
  const bg1 = isDark ? "rgba(15,23,42,0.97)" : "rgba(249,250,251,1)";
  const bg2 = isDark ? "rgba(9,14,28,1)" : "rgba(241,245,249,1)";
  const border = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const borderY = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.07)";
  const gridSolid = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.09)";
  const gridDash = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
  const tickCol = isDark ? "rgba(148,163,184,0.55)" : "rgba(71,85,105,0.65)";
  const lblCol = isDark ? "rgba(148,163,184,0.50)" : "rgba(71,85,105,0.55)";
  const tipBg = isDark ? "rgba(15,23,42,0.96)" : "rgba(255,255,255,0.97)";
  const bgSurface = isDark ? "#0f172a" : "#f8fafc";
  
  const bar1Color = isDark ? "rgba(16,185,129,0.2)" : "rgba(16,185,129,0.2)"; // Emerald
  const bar2Color = isDark ? "rgba(244,63,94,0.2)" : "rgba(244,63,94,0.2)";  // Rose
  const line1Color = isDark ? palRev.lineD : palRev.lineL;
  const line2Color = isDark ? palExp.lineD : palExp.lineL;

  const TIP_W = 220;
  const tipLeft = Math.min(Math.max(tooltipPos.x - TIP_W / 2, 10), (chartRef.current?.clientWidth ?? 800) - TIP_W - 10);
  const tipTop = tooltipPos.y - 120;

  // ── MATEMÁTICA RELATIVA PARA O SVG ──
  const getX = (i: number) => {
    const step = 100 / data.length;
    return (i * step) + (step / 2); // Devolve em porcentagem (0 a 100)
  };
  const getY = (val: number | undefined) => {
    if (val === undefined || maxNice === 0) return 100;
    return 100 - ((val / maxNice) * 100); // Devolve em porcentagem (0 a 100)
  };

  const pathLine1 = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.line1)}`).join(" ");
  const pathLine2 = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.line2)}`).join(" ");

  return (
    <div className={`relative w-full ${heightClass}`} ref={chartRef} onMouseLeave={handleMouseLeave} style={{ background: `linear-gradient(160deg,${bg1} 0%,${bg2} 100%)`, borderRadius: "0.875rem", border: `1px solid ${border}`, boxShadow: isDark ? "0 4px 6px -1px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.04)" : "0 1px 3px rgba(0,0,0,.07),inset 0 1px 0 rgba(255,255,255,.9)" }}>
      
      {/* Container Principal em Grid (Eixo Y Fixo | Gráfico Fluído) */}
      <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: "0.875rem", display: "grid", gridTemplateColumns: "44px 1fr" }}>
        
        {/* Eixo Y */}
        <div className="relative" style={{ borderRight: `1px solid ${borderY}` }}>
          {ticks.map((t, i) => (
            <div key={i} className="absolute left-0 w-full" style={{ bottom: `calc(${(i / 4) * 100}% + 1.75rem)` }}>
              <span className="absolute right-2 tabular-nums leading-none" style={{ fontSize: "9px", color: tickCol, transform: "translateY(50%)" }}>
                {fmt(t)}
              </span>
            </div>
          ))}
        </div>

        {/* Área Principal (Grades e Barras HTML) */}
        <div className="relative px-2 pt-4 pb-7">
          {ticks.map((_, i) => (
            <div key={i} className="pointer-events-none absolute left-0 right-0" style={{ bottom: `calc(${(i / 4) * 100}% + 1.75rem)`, borderTop: `1px ${i === 0 ? "solid" : "dashed"} ${i === 0 ? gridSolid : gridDash}` }} />
          ))}

          <div className="h-full flex items-end gap-[3px] relative z-10">
            {data.map((item, idx) => {
              const pct1 = maxNice > 0 ? ((item.bar1 || 0) / maxNice) * 100 : 0;
              const pct2 = maxNice > 0 ? ((item.bar2 || 0) / maxNice) * 100 : 0;
              const isH = hoveredIdx === idx;

              return (
                <div key={idx}
                  onMouseMove={(e) => handleMouseMove(e, idx)}
                  onTouchStart={(e) => {
                    const t = e.touches[0];
                    setHoveredIdx(cur => cur === idx ? null : idx);
                    if (chartRef.current) {
                      setTooltipPos({ x: t.clientX - chartRef.current.getBoundingClientRect().left, y: t.clientY - chartRef.current.getBoundingClientRect().top });
                    }
                  }}
                  className="relative flex-1 h-full flex items-end justify-center gap-[2px] sm:gap-1 cursor-pointer"
                >
                  {/* Glow Effects */}
                  {item.bar1 !== undefined && item.bar1 > 0 && <div className="absolute bottom-0 left-1/2 -translate-x-[110%] w-1/3 rounded-full" style={{ height: `${pct1 * 0.55}%`, background: isH ? palRev.glowHL : palRev.glowL, filter: "blur(6px)", opacity: isH ? 1 : 0.6, transition: "all .2s" }} />}
                  {item.bar2 !== undefined && item.bar2 > 0 && <div className="absolute bottom-0 left-1/2 translate-x-[10%] w-1/3 rounded-full" style={{ height: `${pct2 * 0.55}%`, background: isH ? palExp.glowHL : palExp.glowL, filter: "blur(6px)", opacity: isH ? 1 : 0.6, transition: "all .2s" }} />}

                  {/* Barras HTML */}
                  {item.bar1 !== undefined && (
                    <div className="relative w-[30%] sm:w-[40%] max-w-[24px] rounded-t-sm sm:rounded-t-md" style={{ height: item.bar1 === 0 ? "2px" : `${pct1}%`, background: item.bar1 === 0 ? "rgba(150,150,150,0.1)" : bar1Color, opacity: isH || item.bar1 === 0 ? 1 : 0.8, transition: "height .5s ease, opacity .2s", boxShadow: `inset 0 1px 0 rgba(255,255,255,0.2)` }} />
                  )}
                  {item.bar2 !== undefined && (
                    <div className="relative w-[30%] sm:w-[40%] max-w-[24px] rounded-t-sm sm:rounded-t-md" style={{ height: item.bar2 === 0 ? "2px" : `${pct2}%`, background: item.bar2 === 0 ? "rgba(150,150,150,0.1)" : bar2Color, opacity: isH || item.bar2 === 0 ? 1 : 0.8, transition: "height .5s ease, opacity .2s", boxShadow: `inset 0 1px 0 rgba(255,255,255,0.2)` }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Eixo X Labels */}
          <div className="absolute left-0 right-0 bottom-0 px-2 pb-[6px]">
            <div className="flex gap-[3px]">
              {data.map((d, i) => (
                <div key={i} className="flex-1 text-center overflow-hidden">
                  <span style={{ fontSize: "9px", color: hoveredIdx === i ? (isDark ? "#fff" : "#000") : lblCol, fontVariantNumeric: "tabular-nums", transition: "color .15s", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {d.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ── LINHAS SVG RELATIVAS ── */}
          {/* Removido o preserveAspectRatio="none" que estava achatando as linhas e usamos viewBox="0 0 100 100" com escalonamento puro de CSS */}
          <svg className="absolute left-2 right-2 pointer-events-none z-20 overflow-visible" style={{ top: "16px", bottom: "28px", width: "calc(100% - 16px)", height: "calc(100% - 44px)" }} viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <filter id="glowRev" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.5" result="blur" /><feComposite in="SourceGraphic" in2="blur" operator="over" /></filter>
              <filter id="glowExp" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.5" result="blur" /><feComposite in="SourceGraphic" in2="blur" operator="over" /></filter>
            </defs>

            {data.length > 0 && (
              <>
                <path d={pathLine1} fill="none" stroke={line1Color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#glowRev)" className="transition-all duration-500" vectorEffect="non-scaling-stroke" />
                <path d={pathLine2} fill="none" stroke={line2Color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#glowExp)" className="transition-all duration-500" vectorEffect="non-scaling-stroke" />
                
                {data.map((d, i) => {
                  const isH = hoveredIdx === i;
                  return (
                    <g key={i} className={`transition-all duration-300 ${isH ? 'opacity-100' : 'opacity-80'}`}>
                      {/* Ao invés de usar <circle> (que deforma com preserveAspectRatio="none"), usamos um quadrado arrendondado com o stroke fixo */}
                      {d.line1 !== undefined && <rect x={getX(i)} y={getY(d.line1)} width="0.1" height="0.1" fill={bgSurface} stroke={line1Color} strokeWidth={isH ? "10" : "7"} strokeLinecap="round" strokeLinejoin="round" className="transition-all duration-300" vectorEffect="non-scaling-stroke" />}
                      
                      {d.line2 !== undefined && <rect x={getX(i)} y={getY(d.line2)} width="0.1" height="0.1" fill={bgSurface} stroke={line2Color} strokeWidth={isH ? "10" : "7"} strokeLinecap="round" strokeLinejoin="round" className="transition-all duration-300" vectorEffect="non-scaling-stroke" />}
                    </g>
                  );
                })}
              </>
            )}
          </svg>

        </div>
      </div>

      {/* ── TOOLTIP ── */}
      {hoveredItem && (
        <div className="pointer-events-none absolute z-50 animate-in fade-in zoom-in-95 duration-100 ease-out shadow-xl"
             style={{ left: tipLeft, top: tipTop < 0 ? tooltipPos.y + 16 : tipTop, width: TIP_W }}>
          <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-xl p-3">
            <div className="font-bold text-xs text-slate-800 dark:text-white mb-2 pb-2 border-b border-slate-100 dark:border-white/5">
              {hoveredItem.tooltipTitle}
            </div>
            <div className="space-y-1">
              {hoveredItem.tooltipContent}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}