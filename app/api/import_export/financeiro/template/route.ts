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
    "• Tipo: Use exatamente RECEITA ou DESPESA (em maiúsculas).",
    "• Valor: Use apenas números e vírgula para os centavos (Ex: 1500,00 ou 40,00). Não use R$ nem pontos de milhar.",
    "• Data Vencimento e Data Pagamento: Use obrigatoriamente o formato DD/MM/AAAA (Ex: 30/04/2026).",
    "• Status: Use exatamente PAGO ou PENDENTE (em maiúsculas).",
    "• Data Pagamento: Obrigatória se Status = PAGO. Se deixar vazio com Status PAGO, o sistema usará a Data Vencimento.",
    "• Conta: Digite o nome EXATO da conta cadastrada no seu painel (Ex: C6 Bank, Nubank, Carteira). A conta precisa existir antes da importação.",
    "• Categoria: Digite o nome EXATO da categoria cadastrada no seu painel (Ex: Salário, Moradia, Cartão de Crédito). A categoria precisa existir antes da importação.",
    "• Recorrência: Use Única, Recorrente ou Parcelada.",
    "• Frequência: Obrigatória para Recorrente e Parcelada. Use: MENSAL, BIMESTRAL, TRIMESTRAL, SEMESTRAL ou ANUAL.",
    "• Parcelas: Obrigatório para Parcelada. Informe o número total de parcelas (Ex: 6, 12, 24). O sistema cria automaticamente todas as parcelas futuras.",
    "• Para Recorrente, o sistema cria automaticamente 60 ocorrências futuras (5 anos).",
    "🔒 ATENÇÃO 1: Conta e Categoria precisam estar cadastradas no painel antes da importação. Caso contrário, a linha será ignorada com erro.",
    "🔒 ATENÇÃO 2: Não altere, não apague e não mude a ordem dos cabeçalhos das colunas (Linha 1).",
    "🔒 ATENÇÃO 3: Exclua as linhas de exemplo e estas instruções antes de realizar o upload do arquivo.",
  ];

  const worksheet = XLSX.utils.aoa_to_sheet([
    headers,
    ...examples,
    [], // linha em branco separadora
    ...notes.map((n) => [n]),
  ]);

  // Forçar coluna Valor (col 2) como texto para não virar número com formatação errada
  const textColumns = [2];
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
    { wch: 12 }, // Valor
    { wch: 16 }, // Data Vencimento
    { wch: 10 }, // Status
    { wch: 16 }, // Data Pagamento
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