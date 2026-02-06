import React from "react";

export type SimpleBarChartDatum = {
  label: string;
  value: number;
  displayValue: number;
  tooltipTitle: string;
  tooltipContent: string;
};

interface SimpleBarChartProps {
  data: SimpleBarChartDatum[];
  colorClass?: string; // ex: "from-emerald-400 to-emerald-600"
  label?: string;      // ex: "Cadastros"
}

export function SimpleBarChart({ 
  data, 
  colorClass = "from-zinc-400 to-zinc-600", 
  label 
}: SimpleBarChartProps) {
  
  // 1. Calcular o valor máximo para definir a escala (altura 100%)
  const maxValue = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="w-full h-48 flex items-end gap-1 pt-6 select-none" role="img" aria-label={`Gráfico de ${label}`}>
      {data.map((item, index) => {
        // Calcula a porcentagem da altura
        const heightPercent = (item.value / maxValue) * 100;

        return (
          <div 
            key={index} 
            className="group relative flex-1 h-full flex flex-col justify-end items-center"
          >
            {/* --- TOOLTIP (Aparece no Hover) --- */}
            <div className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-20 pointer-events-none">
              <div className="bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 text-xs rounded-md py-1.5 px-3 shadow-xl whitespace-nowrap text-center">
                <div className="font-bold mb-0.5">{item.tooltipTitle}</div>
                <div className="opacity-90 font-medium">{item.tooltipContent}</div>
                
                {/* Setinha do tooltip */}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-900 dark:border-t-white"></div>
              </div>
            </div>

            {/* --- A BARRA --- */}
            <div
              style={{ height: `${heightPercent}%` }}
              className={`
                w-full max-w-[12px] min-h-[4px] rounded-t-sm
                bg-gradient-to-t ${colorClass}
                opacity-80 group-hover:opacity-100 group-hover:scale-y-105
                transition-all duration-300 ease-out origin-bottom
              `}
            />
            
            {/* --- Eixo X (Opcional: mostra dia se houver espaço, ou apenas visual limpo) --- */}
            {/* Aqui deixei invisível para manter o visual "clean" do dashboard, 
                já que o tooltip mostra o dia exato */}
            <div className="h-px w-full bg-zinc-100 dark:bg-zinc-800 mt-[-1px] z-0"></div>
          </div>
        );
      })}
    </div>
  );
}