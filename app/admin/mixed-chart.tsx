"use client";

import React, { useMemo, useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";

export type MixedChartDatum = {
  label: string;
  bar1?: number;
  bar2?: number;
  line1?: number;
  line2?: number;
  tooltipTitle: string;
  tooltipItems: {
    label: string;
    value: string;
    colorClass: string;
    isSeparator?: boolean;
  }[];
};

interface MixedChartProps {
  data: MixedChartDatum[];
  heightClass?: string;
  formatValue?: (v: number) => string;
}

function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const check = () =>
      setDark(document.documentElement.classList.contains("dark"));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => mo.disconnect();
  }, []);
  return dark;
}

function MixedChartBase({
  data,
  heightClass = "h-80",
  formatValue,
}: MixedChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(800);
  const isDark = useIsDark();

  useEffect(() => {
    if (!chartRef.current) return;
    const observer = new ResizeObserver((entries) => {
      setChartWidth(entries[0].contentRect.width);
    });
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);

  const chartHeight = 260;

  const { maxNice, ticks } = useMemo(() => {
    let rawMax = 0;
    data.forEach((d) => {
      rawMax = Math.max(
        rawMax,
        d.bar1 || 0,
        d.bar2 || 0,
        d.line1 || 0,
        d.line2 || 0,
      );
    });
    const niceCeil = (n: number) => {
      if (n <= 0) return 1;
      const exp = Math.pow(10, Math.floor(Math.log10(n)));
      const f = n / exp;
      const nice =
        f <= 1
          ? 1
          : f <= 1.2
            ? 1.2
            : f <= 1.5
              ? 1.5
              : f <= 2
                ? 2
                : f <= 2.5
                  ? 2.5
                  : f <= 3
                    ? 3
                    : f <= 4
                      ? 4
                      : f <= 5
                        ? 5
                        : f <= 6
                          ? 6
                          : f <= 8
                            ? 8
                            : 10;
      return Math.ceil(nice * exp);
    };
    const max = niceCeil(rawMax || 1);
    return {
      maxNice: max,
      ticks: Array.from({ length: 5 }, (_, i) => (max * i) / 4),
    };
  }, [data]);

  const fmt =
    formatValue ||
    ((v: number) => {
      if (v === 0) return "0";
      return v >= 1000
        ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
        : String(Math.round(v));
    });

  const bgSurface = isDark ? "#18212f" : "#ffffff";
  const gridLine = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const textColor = isDark ? "rgba(148,163,184,0.6)" : "rgba(71,85,105,0.6)";
  const bar1Color = isDark ? "rgba(16,185,129,0.22)" : "rgba(16,185,129,0.22)";
  const bar2Color = isDark ? "rgba(244,63,94,0.22)" : "rgba(244,63,94,0.22)";
  const line1Color = isDark ? "#10b981" : "#10b981";
  const line2Color = isDark ? "#f43f5e" : "#e11d48";

  const paddingLeft = 48;
  const paddingRight = 16;
  const paddingTop = 16;
  const paddingBottom = 36;

  const drawWidth = chartWidth - paddingLeft - paddingRight;
  const drawHeight = chartHeight - paddingTop - paddingBottom;

  const stepX = data.length > 0 ? drawWidth / data.length : 0;
  const barWidth = Math.min(stepX * 0.32, 28);

  const getX = (i: number) => paddingLeft + i * stepX + stepX / 2;
  const getY = (val: number | undefined) => {
    if (val === undefined || maxNice === 0) return chartHeight - paddingBottom;
    return chartHeight - paddingBottom - (val / maxNice) * drawHeight;
  };

  const pathLine1 = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(d.line1)}`)
    .join(" ");
  const pathLine2 = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${getX(i)} ${getY(d.line2)}`)
    .join(" ");

  return (
    <div className={`relative w-full ${heightClass}`} ref={chartRef}>
      {/* Eixo Y — labels HTML */}
      {ticks.map((t, i) => {
        const y = getY(t);
        return (
          <div
            key={i}
            className="absolute pointer-events-none"
            style={{
              left: 0,
              top: y - 6,
              width: paddingLeft - 8,
              textAlign: "right",
              zIndex: 10,
            }}
          >
            <span
              className="sv tabular-nums text-[9px] sm:text-[10px]"
              style={{ color: textColor }}
            >
              {fmt(t)}
            </span>
          </div>
        );
      })}

      <svg
        width={chartWidth}
        height={chartHeight}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="absolute inset-0"
      >
        {/* Grid */}
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={paddingLeft}
            y1={getY(t)}
            x2={chartWidth - paddingRight}
            y2={getY(t)}
            stroke={gridLine}
            strokeWidth="1"
            strokeDasharray={i === 0 ? "none" : "4 4"}
          />
        ))}

        {/* Barras + labels X */}
        {data.map((d, i) => {
          const cx = getX(i);
          const y0 = chartHeight - paddingBottom;

          const yB1 = getY(d.bar1);
          const hB1 = y0 - yB1;
          const yB2 = getY(d.bar2);
          const hB2 = y0 - yB2;

          return (
            <g key={i}>
              {d.bar1 !== undefined && hB1 > 0 && (
                <rect
                  x={cx - barWidth - 2}
                  y={yB1}
                  width={barWidth}
                  height={hB1}
                  fill={bar1Color}
                  rx="3"
                  opacity="0.75"
                />
              )}
              {d.bar2 !== undefined && hB2 > 0 && (
                <rect
                  x={cx + 2}
                  y={yB2}
                  width={barWidth}
                  height={hB2}
                  fill={bar2Color}
                  rx="3"
                  opacity="0.75"
                />
              )}
              <text
                x={cx}
                y={y0 + 18}
                fontSize="9"
                fill={textColor}
                textAnchor="middle"
                fontWeight="bold"
                fontFamily="sans-serif"
              >
                {d.label}
              </text>
            </g>
          );
        })}

        {/* Linhas + pontos */}
        {data.length > 0 && (
          <>
            {/* Glow */}
            <path
              d={pathLine1}
              fill="none"
              stroke={line1Color}
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.12"
              style={{ filter: "blur(4px)" }}
            />
            <path
              d={pathLine2}
              fill="none"
              stroke={line2Color}
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.12"
              style={{ filter: "blur(4px)" }}
            />

            {/* Linhas principais */}
            <path
              d={pathLine1}
              fill="none"
              stroke={line1Color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={pathLine2}
              fill="none"
              stroke={line2Color}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Pontos */}
            {data.map((d, i) => (
              <g key={`dots-${i}`}>
                {d.line1 !== undefined && (
                  <circle
                    cx={getX(i)}
                    cy={getY(d.line1)}
                    r="3.5"
                    fill={bgSurface}
                    stroke={line1Color}
                    strokeWidth="2.5"
                    className="pointer-events-none"
                  />
                )}
                {d.line2 !== undefined && (
                  <circle
                    cx={getX(i)}
                    cy={getY(d.line2)}
                    r="3.5"
                    fill={bgSurface}
                    stroke={line2Color}
                    strokeWidth="2.5"
                    className="pointer-events-none"
                  />
                )}
              </g>
            ))}
          </>
        )}
      </svg>
    </div>
  );
}

export const MixedChart = dynamic(() => Promise.resolve(MixedChartBase), {
  ssr: false,
  loading: () => (
    <div className="h-64 w-full animate-pulse bg-muted rounded-xl" />
  ),
});