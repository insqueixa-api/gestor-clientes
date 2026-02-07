"use client";

import React, { useMemo, useState } from "react";

export type SimpleBarChartDatum = {
  label: string;
  value: number;
  displayValue: number;
  tooltipTitle: string;
  tooltipContent: string;
};

interface SimpleBarChartProps {
  data: SimpleBarChartDatum[];
  mode?: "count" | "currency";   // 👈 NOVO
  colorClass?: string;
  label?: string;
  heightClass?: string;
}

/* ======================
   FORMATADORES
====================== */

const fmtInt = (v:number)=>
  new Intl.NumberFormat("pt-BR").format(v);

const fmtBRL = (v:number)=>
  new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",maximumFractionDigits:0}).format(v);

/* ======================
   NICE SCALE (pro level)
====================== */

function niceCeil(n:number){
  if(n<=0)return 1;
  const exp=Math.pow(10,Math.floor(Math.log10(n)));
  const f=n/exp;
  const nice=f<=1?1:f<=2?2:f<=5?5:10;
  return nice*exp;
}

export function SimpleBarChart({
  data,
  mode="count",
  colorClass="from-zinc-400 to-zinc-600",
  label,
  heightClass="h-48"
}:SimpleBarChartProps){

  const [selected,setSelected]=useState<number|null>(null);

  const {maxNice,ticks}=useMemo(()=>{

    const rawMax=Math.max(...data.map(d=>d.value),0);
    const maxNice=niceCeil(rawMax||1);

    const ticks=Array.from({length:5},(_,i)=>(maxNice*i)/4);

    return {maxNice,ticks};

  },[data]);

  const selectedItem=selected!=null?data[selected]:null;

  const xEvery=
    data.length<=8?1:
    data.length<=16?2:
    data.length<=24?3:4;

  const formatY=(v:number)=>{
    return mode==="currency"?fmtBRL(v):fmtInt(v);
  };

  return(
    <div className="w-full">

      {/* TOOLTIP FIXO */}
<div className="min-h-[44px] mb-2">
  {selectedItem ? (
    <div className="inline-flex gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-xs shadow-sm">
      <div className="font-semibold">{selectedItem.tooltipTitle}</div>
      <div>{selectedItem.tooltipContent}</div>
    </div>
  ) : (
    <div className="text-xs text-zinc-500">Toque/clique em uma barra</div>
  )}
</div>

<div
  className={`relative w-full ${heightClass} rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden`}
>
  <div className="absolute inset-0 grid grid-cols-[48px_1fr]">
    {/* Eixo Y (só labels) */}
    <div className="relative border-r border-zinc-200 dark:border-zinc-800">
      {ticks.map((t, i) => {
        const pct = (i / 4) * 100;
        return (
          <div key={i} className="absolute left-0 w-full" style={{ bottom: `${pct}%` }}>
            <div className="absolute -top-2 left-1 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
              {Math.round(t)}
            </div>
          </div>
        );
      })}
    </div>

    {/* BARRAS */}
    <div className="relative">
      <div className="absolute inset-0 px-3 pt-3 pb-7">
        {/* ✅ GRID HORIZONTAL EM TODO O GRÁFICO */}
        <div className="pointer-events-none absolute inset-0">
          {ticks.map((_, i) => {
            const pct = (i / 4) * 100;
            return (
              <div
                key={i}
                className="absolute left-0 right-0 border-t border-dashed border-zinc-200 dark:border-zinc-800"
                style={{ bottom: `${pct}%` }}
              />
            );
          })}
        </div>

        <div className="h-full flex items-end gap-2 relative">
          {data.map((item, idx) => {
            const h = maxNice > 0 ? (item.value / maxNice) * 100 : 0;
            const isZero = item.value <= 0;
            const isSelected = selected === idx;

            return (
              <button
                key={idx}
                type="button"
                onClick={() => setSelected((cur) => (cur === idx ? null : idx))}
                disabled={isZero}
                className={`group relative flex-1 h-full flex items-end ${
                  isZero ? "opacity-30" : "cursor-pointer"
                }`}
                aria-label={`${label ?? "valor"}: ${item.displayValue}`}
              >
                <div
                  style={{ height: `${h}%` }}
                  className={`
                    w-full rounded-md bg-gradient-to-t ${colorClass}
                    transition-all duration-200 origin-bottom
                    ${isSelected ? "ring-2 opacity-100" : "opacity-85 group-hover:opacity-100"}
                  `}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* EIXO X */}
      <div className="absolute left-0 right-0 bottom-0 px-3 pb-2">
        <div className="flex gap-2">
          {data.map((d, i) => (
            <div key={i} className="flex-1 text-center">
              {i % xEvery === 0 ? (
                <div className="text-[10px] text-zinc-500 tabular-nums">{d.label}</div>
              ) : (
                <div className="h-3" />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
</div>
    </div>
  );
}
