// app/admin/evolucao-chart.tsx
import { createClient } from "@/lib/supabase/server";
import { EvolucaoFinanceiraClient } from "./evolucao-client";

export type MonthData = {
  label: string;
  key: string;
  bar1: number; // Receita Prevista
  bar2: number; // Despesa Prevista
  line1: number; // Receita Executada
  line2: number; // Despesa Executada
};

export default async function EvolucaoFinanceira({
  myTenantId,
}: {
  myTenantId: string | null;
}) {
  if (!myTenantId) return null;

  const supabase = await createClient();

  // 1. Gerar os últimos 12 meses
  const today = new Date();
  const months: { label: string; key: string; start: string; end: string }[] =
    [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const lastDay = new Date(y, m, 0).getDate();
    const mStr = String(m).padStart(2, "0");
    months.push({
      label: `${mStr}/${String(y).slice(-2)}`,
      key: `${y}-${mStr}`,
      start: `${y}-${mStr}-01`,
      end: `${y}-${mStr}-${String(lastDay).padStart(2, "0")}`,
    });
  }

  const startDate = months[0].start;
  const endDate = months[11].end;

  // 2. Buscar transações
  const { data: finData, error } = await supabase
    .from("fin_transacoes")
    .select("tipo, valor, status, data_vencimento, data_pagamento")
    .eq("tenant_id", myTenantId)
    .or(
      `and(data_vencimento.gte.${startDate},data_vencimento.lte.${endDate}),` +
        `and(status.eq.PAGO,data_pagamento.gte.${startDate},data_pagamento.lte.${endDate}T23:59:59)`,
    );

  if (error) console.error("[EvolucaoFinanceira]", error);

  // 3. Agregar por mês
  const chartData: MonthData[] = months.map((m) => {
    let bar1 = 0,
      bar2 = 0,
      line1 = 0,
      line2 = 0;

    finData?.forEach((row) => {
      const val = Number(row.valor) || 0;

      // Previsão: data_vencimento no mês
      if (row.data_vencimento?.startsWith(m.key)) {
        if (row.tipo === "RECEITA") bar1 += val;
        if (row.tipo === "DESPESA") bar2 += val;
      }

      // Executado: PAGO com data_pagamento no mês (normaliza timestamp)
      const dpDate = row.data_pagamento
        ? row.data_pagamento.split("T")[0]
        : null;
      if (row.status === "PAGO" && dpDate?.startsWith(m.key)) {
        if (row.tipo === "RECEITA") line1 += val;
        if (row.tipo === "DESPESA") line2 += val;
      }
    });

    return { label: m.label, key: m.key, bar1, bar2, line1, line2 };
  });

  return <EvolucaoFinanceiraClient data={chartData} />;
}
