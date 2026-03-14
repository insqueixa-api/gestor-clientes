import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const headers = [
      "Nome do Servidor",
      "Tipo de Painel (WEB ou TELEGRAM)",
      "Url ou Grupo Telegram",
      "Moeda (BRL, USD, EUR)",
      "Custo Unitario",
      "Saldo Inicial",
      "DNS 1",
      "DNS 2",
      "DNS 3",
      "DNS 4",
      "DNS 5",
      "DNS 6",
      "Observacoes"
    ];

    const exampleRow = [
      "P2P VIP",
      "WEB",
      "https://painel.meup2p.com",
      "BRL",
      "15,00",
      "100",
      "p2p.exemplo.com",
      "p2p-alt.exemplo.com",
      "", "", "", "",
      "Servidor principal migrado"
    ];

    const notes = [
      "⚠️ INSTRUÇÕES PARA IMPORTAÇÃO DE SERVIDORES ⚠️",
      "• Nome do Servidor: É OBRIGATÓRIO e deve ser único.",
      "• Tipo de Painel: Digite exatamente 'WEB' ou 'TELEGRAM' (ou deixe vazio se não houver).",
      "• Moeda: Digite BRL, USD ou EUR.",
      "• Custo Unitario e Saldo Inicial: Use apenas números e vírgula para centavos (Ex: 15,50).",
      "• DNS: Você pode configurar até 6 links de DNS.",
      "🔒 IMPORTANTE: A API de Integração não é importada via planilha por questões de segurança e sincronização. Após importar os servidores, acesse o painel e vincule a integração manualmente em cada servidor criado.",
      "• Não altere os cabeçalhos das colunas.",
      "• Exclua a linha de exemplo e estas instruções antes de importar."
    ];

    const worksheet = XLSX.utils.aoa_to_sheet([
      headers,
      exampleRow,
      [], 
      ...notes.map((n) => [n]),
    ]);

    worksheet["!cols"] = [
      { wch: 25 }, // Nome
      { wch: 35 }, // Tipo Panel
      { wch: 35 }, // URL/Grupo
      { wch: 25 }, // Moeda
      { wch: 18 }, // Custo
      { wch: 18 }, // Saldo
      { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, // DNS 1 a 6
      { wch: 30 }  // Obs
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Disposition": 'attachment; filename="template_importacao_servidores.xlsx"',
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Erro ao gerar template." }, { status: 500 });
  }
}