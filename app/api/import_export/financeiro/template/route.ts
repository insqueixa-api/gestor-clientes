import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = [
    "Tipo",
    "Descrição",
    "Valor",
    "Data Vencimento",
    "Status",
    "Data Pagamento",
    "Conta",
    "Categoria",
    "Recorrência",
    "Frequência",
    "Parcelas",
    "Observações",
  ];

  const examples = [
    [
      "RECEITA",
      "Salário",
      "5000,00",
      "30/04/2026",
      "PAGO",
      "30/04/2026",
      "C6 Bank",
      "Salário",
      "Única",
      "",
      "",
      "Salário mensal",
    ],
    [
      "DESPESA",
      "Aluguel",
      "1500,00",
      "05/04/2026",
      "PAGO",
      "05/04/2026",
      "C6 Bank",
      "Moradia",
      "Recorrente",
      "MENSAL",
      "",
      "Pagamento mensal",
    ],
    [
      "DESPESA",
      "Cartão de Crédito",
      "4800,00",
      "10/04/2026",
      "PENDENTE",
      "",
      "Nubank",
      "Cartão de Crédito",
      "Parcelada",
      "MENSAL",
      "6",
      "Parcela 1 de 6 — Compra TV",
    ],
  ];

  const notes = [
    "⚠️ INSTRUÇÕES PARA IMPORTAÇÃO DE LANÇAMENTOS FINANCEIROS ⚠️",
    "• Campos Obrigatórios: Tipo, Descrição, Valor, Data Vencimento, Status, Conta e Categoria.",
    "• Tipo: Use RECEITA ou DESPESA (aceita maiúsculas, minúsculas e variações como 'entrada', 'saida', 'gasto').",
    "• Valor: Aceita qualquer formato — R$ 1.500,00 / 1500,00 / 1500.00 / R$40. O sistema normaliza automaticamente.",
    "• Data Vencimento e Data Pagamento: Aceita vários formatos — 30/04/2026 / 30-04-2026 / 2026-04-30 / 30 abr 26 / 30 abril 2026 / abr 30 2026.",
    "• Status: Use PAGO ou PENDENTE (aceita variações como 'Paga', 'Recebido', 'Em aberto', 'Aguardando').",
    "• Data Pagamento: Obrigatória se Status = PAGO. Se deixar vazio, o sistema usará a Data Vencimento como fallback.",
    "• Conta: Digite o nome da conta. Se a conta não existir no painel, o sistema criará automaticamente.",
    "• Categoria: Digite o nome da categoria. Se não existir, o sistema criará automaticamente.",
    "• Recorrência: Use Única, Recorrente ou Parcelada (aceita variações como 'fixo', 'parcelado', 'continuo').",
    "• Frequência: Obrigatória para Recorrente e Parcelada. Use: MENSAL, BIMESTRAL, TRIMESTRAL, SEMESTRAL ou ANUAL.",
    "• Parcelas: Obrigatório para Parcelada. Informe o número total de parcelas (Ex: 6, 12, 24). O sistema cria todas as parcelas futuras automaticamente.",
    "• Para Recorrente, o sistema cria automaticamente 60 ocorrências futuras (5 anos).",
    "🔒 ATENÇÃO 1: Não altere, não apague e não mude a ordem dos cabeçalhos das colunas (Linha 1).",
    "🔒 ATENÇÃO 2: Exclua as linhas de exemplo e estas instruções antes de realizar o upload do arquivo.",
  ];

  const worksheet = XLSX.utils.aoa_to_sheet([
    headers,
    ...examples,
    [], // linha em branco separadora
    ...notes.map((n) => [n]),
  ]);

  // Forçar coluna Valor (col 2) como texto para preservar formato pt-BR
  const textColumns = [2]; // Valor
  examples.forEach((_, rowIdx) => {
    textColumns.forEach((C) => {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIdx + 1, c: C });
      if (worksheet[cellAddress]) {
        worksheet[cellAddress].t = "s";
        worksheet[cellAddress].z = "@";
      }
    });
  });

  // Largura das colunas
  worksheet["!cols"] = [
    { wch: 10 }, // Tipo
    { wch: 30 }, // Descrição
    { wch: 14 }, // Valor
    { wch: 18 }, // Data Vencimento
    { wch: 10 }, // Status
    { wch: 18 }, // Data Pagamento
    { wch: 20 }, // Conta
    { wch: 25 }, // Categoria
    { wch: 14 }, // Recorrência
    { wch: 14 }, // Frequência
    { wch: 10 }, // Parcelas
    { wch: 40 }, // Observações
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Template");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="template_financeiro.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
