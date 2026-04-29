"use client";

import React, { useMemo, useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";

export type MixedChartDatum = {
  label: string;
  bar1?: number; // Previsão Receita (Barra Verde clara)
  bar2?: number; // Previsão Despesa (Barra Vermelha clara)
  line1?: number; // Executado Receita (Linha Verde forte)
  line2?: number; // Executado Despesa (Linha Vermelha forte)
  tooltipTitle: string;
  tooltipItems: { label: string; value: string; colorClass: string; isSeparator?: boolean }[];
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

function MixedChartBase({ data, heightClass = "h-80", formatValue }: MixedChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(800);
  
  const isDark = useIsDark();

  // Resize Observer para manter o SVG responsivo perfeito
  useEffect(() => {
    if (!chartRef.current) return;
    const observer = new ResizeObserver((entries) => {
      setChartWidth(entries[0].contentRect.width);
    });
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);

  const chartHeight = 280; // Altura fixa interna do viewBox do SVG (garante proporção perfeita)

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
  const bgSurface = isDark ? "#0f172a" : "#f8fafc";
  const gridLine = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const textColor = isDark ? "rgba(148,163,184,0.6)" : "rgba(71,85,105,0.6)";

  const bar1Color = isDark ? "rgba(16,185,129,0.2)" : "rgba(16,185,129,0.2)"; // Emerald (Receita Previsão)
  const bar2Color = isDark ? "rgba(244,63,94,0.2)" : "rgba(244,63,94,0.2)";  // Rose (Despesa Previsão)
  const line1Color = isDark ? "#34d399" : "#10b981"; // Emerald forte
  const line2Color = isDark ? "#fb7185" : "#e11d48"; // Rose forte

  // ── MATEMÁTICA DO SVG ──
  const paddingLeft = 50; // Espaço para os números do Eixo Y
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 40; // Espaço para as labels do Eixo X
  
  const drawWidth = chartWidth - paddingLeft - paddingRight;
  const drawHeight = chartHeight - paddingTop - paddingBottom;
  
  const stepX = data.length > 0 ? drawWidth / data.length : 0;
  const barWidth = Math.min(stepX * 0.35, 30); // Barras não ficam giga se tiver poucos dados

  // Gerador de posições X/Y para o SVG
  const getX = (index: number) => paddingLeft + (index * stepX) + (stepX / 2);
  const getY = (val: number | undefined) => {
    if (val === undefined || maxNice === 0) return chartHeight - paddingBottom;
    const ratio = val / maxNice;
    return chartHeight - paddingBottom - (ratio * drawHeight);
  };

  // Geradores das Paths das linhas
  const pathLine1 = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.line1)}`).join(" ");
  const pathLine2 = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(d.line2)}`).join(" ");

  const TIP_W = 220;
  const tipLeft = Math.min(Math.max(tooltipPos.x - TIP_W / 2, 10), chartWidth - TIP_W - 10);
  const tipTop = tooltipPos.y - 120;

  return (
    <div className={`relative w-full ${heightClass}`} ref={chartRef} onMouseLeave={handleMouseLeave}>
      <svg width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="absolute inset-0">
        
        {/* ── GRADES E EIXO Y ── */}
        {ticks.map((t, i) => {
          const y = getY(t);
          return (
            <g key={i}>
              <text className="sv transition-all duration-300" x={paddingLeft - 10} y={y + 4} fontSize="10" fill={textColor} textAnchor="end" fontFamily="sans-serif">
                {fmt(t)}
              </text>
              <line x1={paddingLeft} y1={y} x2={chartWidth - paddingRight} y2={y} stroke={gridLine} strokeWidth="1" strokeDasharray={i === 0 ? "none" : "4 4"} />
            </g>
          );
        })}

        {/* ── BARRAS E EIXO X ── */}
        {data.map((d, i) => {
          const cx = getX(i);
          const y0 = chartHeight - paddingBottom; // Linha Base do Eixo X
          
          const yB1 = getY(d.bar1);
          const hB1 = y0 - yB1;
          
          const yB2 = getY(d.bar2);
          const hB2 = y0 - yB2;

          const isH = hoveredIdx === i;

          return (
            <g key={i}>
              {/* Highlight Hover Vertical (A coluna inteira brilha) */}
              {isH && (
                <rect x={cx - (stepX / 2)} y={paddingTop} width={stepX} height={drawHeight} fill={isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)"} rx="4" />
              )}

              {/* Barra 1 - Receita */}
              {d.bar1 !== undefined && hB1 > 0 && (
                <rect x={cx - barWidth - 2} y={yB1} width={barWidth} height={hB1} fill={bar1Color} rx="3" className="transition-all duration-300" style={{ opacity: isH ? 1 : 0.6 }} />
              )}
              
              {/* Barra 2 - Despesa */}
              {d.bar2 !== undefined && hB2 > 0 && (
                <rect x={cx + 2} y={yB2} width={barWidth} height={hB2} fill={bar2Color} rx="3" className="transition-all duration-300" style={{ opacity: isH ? 1 : 0.6 }} />
              )}

              {/* Label Eixo X */}
              <text x={cx} y={y0 + 20} fontSize="10" fill={isH ? (isDark ? "#fff" : "#000") : textColor} textAnchor="middle" fontWeight="bold" fontFamily="sans-serif" className="transition-colors duration-200">
                {d.label}
              </text>

              {/* Área invisível grande para capturar o MouseHover suavemente */}
              <rect x={cx - (stepX / 2)} y={0} width={stepX} height={chartHeight} fill="transparent" onMouseMove={(e) => handleMouseMove(e, i)} />
            </g>
          );
        })}

        {/* ── LINHAS EXECUTADAS E PONTOS ── */}
        {data.length > 0 && (
          <>
            {/* Sombras das linhas (Glow) */}
            <path d={pathLine1} fill="none" stroke={line1Color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.15" style={{ filter: "blur(4px)" }} />
            <path d={pathLine2} fill="none" stroke={line2Color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.15" style={{ filter: "blur(4px)" }} />
            
            {/* Linhas Principais */}
            <path d={pathLine1} fill="none" stroke={line1Color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-all duration-500" />
            <path d={pathLine2} fill="none" stroke={line2Color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-all duration-500" />

            {/* Pontos sobre as linhas */}
            {data.map((d, i) => {
              const isH = hoveredIdx === i;
              return (
                <g key={`dots-${i}`}>
                  {d.line1 !== undefined && (
                    <circle cx={getX(i)} cy={getY(d.line1)} r={isH ? 5 : 3.5} fill={bgSurface} stroke={line1Color} strokeWidth="2.5" className="transition-all duration-200 pointer-events-none" />
                  )}
                  {d.line2 !== undefined && (
                    <circle cx={getX(i)} cy={getY(d.line2)} r={isH ? 5 : 3.5} fill={bgSurface} stroke={line2Color} strokeWidth="2.5" className="transition-all duration-200 pointer-events-none" />
                  )}
                </g>
              );
            })}
          </>
        )}
      </svg>

      {/* ── TOOLTIP ── */}
      {hoveredItem && (
        <div className="pointer-events-none absolute z-50 animate-in fade-in zoom-in-95 duration-100 ease-out shadow-xl"
             style={{ left: tipLeft, top: tipTop < 0 ? tooltipPos.y + 16 : tipTop, width: TIP_W }}>
          <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-xl p-3">
            <div className="font-bold text-xs text-slate-800 dark:text-white mb-2 pb-2 border-b border-slate-100 dark:border-white/5">
              {hoveredItem.tooltipTitle}
            </div>
            <div className="space-y-1">
              {hoveredItem.tooltipItems?.map((item, i) => {
                if (item.isSeparator) return <div key={i} className="h-px bg-slate-100 dark:bg-white/10 my-1"></div>;
                return (
                  <div key={i} className="flex justify-between items-center text-xs">
                    <span className={item.colorClass}>{item.label}</span>
                    <span className="sv font-mono finance-value text-slate-800 dark:text-white transition-all duration-300">{item.value}</span>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Seta do Balão */}
          <div style={{
            position: "absolute", bottom: tipTop < 0 ? "auto" : "-5px", top: tipTop < 0 ? "-5px" : "auto",
            left: "50%", transform: `translateX(-50%) rotate(${tipTop < 0 ? "180deg" : "0deg"})`,
            width: 0, height: 0, borderLeft: "6px solid transparent", borderRight: "6px solid transparent",
            borderTop: tipTop < 0 ? "none" : `6px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
            borderBottom: tipTop < 0 ? `6px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}` : "none",
          }} />
        </div>
      )}
    </div>
  );
}

export const MixedChart = dynamic(() => Promise.resolve(MixedChartBase), { 
  ssr: false,
  loading: () => <div className="h-80 w-full animate-pulse bg-zinc-100 dark:bg-zinc-800/50 rounded-xl"></div>
});