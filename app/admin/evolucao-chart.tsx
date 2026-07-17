// app/admin/evolucao-chart.tsx
import { createClient } from "@/lib/supabase/server";
import { EvolucaoFinanceiraClient } from "./evolucao-client";

export type MonthData = {
  label: string;
  key: string;
  bar1: number; // Receita Prevista (congelada, quando houver fotografia)
  bar2: number; // Despesa Prevista (congelada, quando houver fotografia)
  line1: number; // Receita Executada
  line2: number; // Despesa Executada
  ajuste1: number; // Receita: surgiu depois da fotografia
  ajuste2: number; // Despesa: surgiu depois da fotografia
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
    .select("id, tipo, valor, status, data_vencimento, data_pagamento")
    .eq("tenant_id", myTenantId)
    .or(
      `and(data_vencimento.gte.${startDate},data_vencimento.lte.${endDate}),` +
        `and(status.eq.PAGO,data_pagamento.gte.${startDate},data_pagamento.lte.${endDate}T23:59:59)`,
    );

  if (error) console.error("[EvolucaoFinanceira]", error);

  // 2b. Buscar fotografias já tiradas (Previsto congelado) pros meses do período
  const { data: snapData, error: snapError } = await supabase
    .from("fin_previsao_snapshot")
    .select("ano_mes, transacao_id, origem, tipo, valor")
    .eq("tenant_id", myTenantId)
    .in("ano_mes", months.map((m) => m.key));

  if (snapError) console.error("[EvolucaoFinanceira][snapshot]", snapError);

  const snapByMonth = new Map<
    string,
    { receita: number; despesa: number; transacaoIds: Set<string> }
  >();
  snapData?.forEach((s) => {
    const bucket =
      snapByMonth.get(s.ano_mes) ??
      { receita: 0, despesa: 0, transacaoIds: new Set<string>() };
    const val = Number(s.valor) || 0;
    if (s.tipo === "RECEITA") bucket.receita += val;
    if (s.tipo === "DESPESA") bucket.despesa += val;
    if (s.origem === "fin_transacoes" && s.transacao_id) bucket.transacaoIds.add(s.transacao_id);
    snapByMonth.set(s.ano_mes, bucket);
  });

  // 3. Agregar por mês
  const chartData: MonthData[] = months.map((m) => {
    let bar1 = 0,
      bar2 = 0,
      line1 = 0,
      line2 = 0,
      ajuste1 = 0,
      ajuste2 = 0;

    const snap = snapByMonth.get(m.key);
    const hasSnapshot = !!snap;
    if (snap) {
      bar1 = snap.receita;
      bar2 = snap.despesa;
    }

    finData?.forEach((row) => {
      const val = Number(row.valor) || 0;

      // Previsão: data_vencimento no mês
      if (row.data_vencimento?.startsWith(m.key)) {
        if (!hasSnapshot) {
          // Sem fotografia pra esse mês (ainda): mantém o cálculo antigo, ao vivo
          if (row.tipo === "RECEITA") bar1 += val;
          if (row.tipo === "DESPESA") bar2 += val;
        } else if (!snap!.transacaoIds.has(row.id)) {
          // Com fotografia: o que não estava nela é Ajuste, não Previsto
          if (row.tipo === "RECEITA") ajuste1 += val;
          if (row.tipo === "DESPESA") ajuste2 += val;
        }
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

    // ✅ Meses sem fotografia real (antes dessa funcionalidade existir): em vez
    // de deixar a linha de Ajustes vazia, estima usando a diferença entre o
    // que foi Executado e o que tinha sido Previsto (só quando executado >
    // previsto) — não é dado real como julho/26 em diante, é só pra não
    // deixar buraco no histórico.
    if (!hasSnapshot) {
      ajuste1 = Math.max(0, line1 - bar1);
      ajuste2 = Math.max(0, line2 - bar2);
    }

    return { label: m.label, key: m.key, bar1, bar2, line1, line2, ajuste1, ajuste2 };
  });

  return <EvolucaoFinanceiraClient data={chartData} />;
}
