// components/charts/evolucao-chart.tsx
import { EvolucaoFinanceiraClient } from "./evolucao-client";
import { toBRDateStr } from "@/lib/date-br";

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

type EvolucaoTrx = {
  id: string;
  tipo: "RECEITA" | "DESPESA";
  valor: number | string;
  status: string;
  data_vencimento: string;
  data_pagamento: string | null;
  categoria_id: string | null;
};

type EvolucaoSnapshot = {
  ano_mes: string;
  transacao_id: string | null;
  origem: string;
  tipo: "RECEITA" | "DESPESA";
  valor: number | string;
};

// Dados já vêm prontos de get_dashboard_finance_bundle() (chamado uma vez em
// app/admin/page.tsx, em paralelo com o resto do dashboard) — este
// componente não busca mais nada sozinho, só agrega e desenha.
export default function EvolucaoFinanceira({
  transacoes,
  snapshot,
  iptvCategoriaId,
}: {
  transacoes: EvolucaoTrx[];
  snapshot: EvolucaoSnapshot[];
  // ✅ Categoria IPTV nunca vira "Ajuste" aqui — mesmo motivo do card
  // "Receitas por Categoria" (ver app/admin/page.tsx): o lançamento
  // "IPTV - Rendimentos" que a tela Financeiro Pessoal sincroniza em
  // fin_transacoes é dinheiro JÁ recebido (conta como Executado), não uma
  // novidade que deveria inflar o Previsto/Ajuste.
  iptvCategoriaId?: string | null;
}) {
  if (transacoes.length === 0 && snapshot.length === 0) return null;

  const finData = transacoes;
  const snapData = snapshot;

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

  const snapByMonth = new Map<
    string,
    { receita: number; despesa: number; transacaoIds: Set<string> }
  >();
  snapData?.forEach((s) => {
    const bucket = snapByMonth.get(s.ano_mes) ?? {
      receita: 0,
      despesa: 0,
      transacaoIds: new Set<string>(),
    };
    const val = Number(s.valor) || 0;
    if (s.tipo === "RECEITA") bucket.receita += val;
    if (s.tipo === "DESPESA") bucket.despesa += val;
    if (s.origem === "fin_transacoes" && s.transacao_id)
      bucket.transacaoIds.add(s.transacao_id);
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
        } else if (
          !snap!.transacaoIds.has(row.id) &&
          row.categoria_id !== iptvCategoriaId
        ) {
          // Com fotografia: o que não estava nela é Ajuste, não Previsto
          if (row.tipo === "RECEITA") ajuste1 += val;
          if (row.tipo === "DESPESA") ajuste2 += val;
        }
      }

      // Executado: PAGO com data_pagamento no mês (convertido pro fuso do Brasil)
      const dpDate = row.data_pagamento
        ? toBRDateStr(row.data_pagamento)
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

    return {
      label: m.label,
      key: m.key,
      bar1,
      bar2,
      line1,
      line2,
      ajuste1,
      ajuste2,
    };
  });

  return <EvolucaoFinanceiraClient data={chartData} />;
}
