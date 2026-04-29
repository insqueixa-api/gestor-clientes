import { createClient } from "@/lib/supabase/server";
import dynamic from "next/dynamic";

// IMPORTAÇÃO DINÂMICA buscando o export nomeado corretamente
const MixedChart = dynamic(
  () => import("./mixed-chart").then((mod) => mod.MixedChart),
  { 
    ssr: false,
    loading: () => <div className="h-80 w-full animate-pulse bg-zinc-100 dark:bg-zinc-800/50 rounded-xl"></div>
  }
);

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

export default async function EvolucaoFinanceira({ myTenantId }: { myTenantId: string | null }) {
  if (!myTenantId) return null;

  const supabase = await createClient();

  // 1. Gerar os últimos 12 meses
  const today = new Date();
  const months: { label: string; key: string; start: string; end: string }[] = [];
  
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const lastDay = new Date(y, m, 0).getDate();
    
    const mStr = String(m).padStart(2, '0');
    months.push({
      label: `${mStr}/${String(y).slice(-2)}`, // Ex: 04/26
      key: `${y}-${mStr}`, // Ex: 2026-04
      start: `${y}-${mStr}-01`,
      end: `${y}-${mStr}-${String(lastDay).padStart(2, '0')}`,
    });
  }

  const startDate = months[0].start;
  const endDate = months[11].end;

  // 2. Buscar transações financeiras (Vencimento OU Pagamento dentro do período)
  const { data: finData, error } = await supabase
    .from("fin_transacoes")
    .select("tipo, valor, status, data_vencimento, data_pagamento")
    .eq("tenant_id", myTenantId)
    .or(`and(data_vencimento.gte.${startDate},data_vencimento.lte.${endDate}),and(data_pagamento.gte.${startDate},data_pagamento.lte.${endDate})`);

  if (error) {
    console.error("Erro ao buscar evolução financeira:", error);
  }

  // 3. Agregar os dados para o formato do MixedChart
  const chartData = months.map(m => {
    let prevRec = 0, prevDesp = 0;
    let execRec = 0, execDesp = 0;

    finData?.forEach(row => {
      const val = Number(row.valor) || 0;
      
      // PREVISÃO (Barras) - Baseado na data_vencimento
      if (row.data_vencimento && row.data_vencimento.startsWith(m.key)) {
        if (row.tipo === "RECEITA") prevRec += val;
        if (row.tipo === "DESPESA") prevDesp += val;
      }

      // EXECUTADO (Linhas) - Baseado na data_pagamento E status PAGO
      if (row.status === "PAGO" && row.data_pagamento && row.data_pagamento.startsWith(m.key)) {
        if (row.tipo === "RECEITA") execRec += val;
        if (row.tipo === "DESPESA") execDesp += val;
      }
    });

    return {
      label: m.label,
      bar1: prevRec,
      bar2: prevDesp,
      line1: execRec,
      line2: execDesp,
      tooltipTitle: `Resumo - ${m.label}`,
      tooltipItems: [
        { label: "Receita (Prevista)", value: fmtBRL(prevRec), colorClass: "text-emerald-500" },
        { label: "Despesa (Prevista)", value: fmtBRL(prevDesp), colorClass: "text-rose-500" },
        { isSeparator: true, label: "", value: "", colorClass: "" },
        { label: "Receita (Executada)", value: fmtBRL(execRec), colorClass: "text-emerald-600 font-bold" },
        { label: "Despesa (Executada)", value: fmtBRL(execDesp), colorClass: "text-rose-600 font-bold" },
      ]
    };
  });

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-6 shadow-sm">
      <div className="mb-4">
        <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-100">
          Evolução Consolidada (12 Meses)
        </h3>
        <p className="text-xs text-zinc-500 mt-1">
          <strong>Barras:</strong> Previsão (Vencimentos) &nbsp;&bull;&nbsp; <strong>Linhas:</strong> Executado (Pagamentos)
        </p>
      </div>
      
      {/* O componente visual agora é renderizado apenas no cliente */}
      <MixedChart data={chartData} heightClass="h-72 sm:h-96" />
    </div>
  );
}