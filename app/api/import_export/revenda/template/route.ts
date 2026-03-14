import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const headers = [
      "Nome",
      "Telefone principal", // ✅ Alterado
      "Whatsapp Username",  // ✅ Alterado
      "E-mail",
      "Observacoes",
      "Servidor 1 Nome", "Servidor 1 Usuario", "Servidor 1 Senha",
      "Servidor 2 Nome", "Servidor 2 Usuario", "Servidor 2 Senha",
      "Servidor 3 Nome", "Servidor 3 Usuario", "Servidor 3 Senha",
      "Servidor 4 Nome", "Servidor 4 Usuario", "Servidor 4 Senha",
      "Servidor 5 Nome", "Servidor 5 Usuario", "Servidor 5 Senha"
    ];

    const exampleRow = [
      "João Revenda (Exemplo)",
      "5511999999999",
      "joao_revenda",
      "joao@email.com",
      "Veio do painel antigo",
      "Nome do Seu Servidor A", "joao123", "senha123",
      "Nome do Seu Servidor B", "joaotv", "senha456",
      "", "", "",
      "", "", "",
      "", "", ""
    ];

    const notes = [
      "⚠️ INSTRUÇÕES PARA IMPORTAÇÃO DE REVENDEDORES ⚠️",
      "• Nome e Telefone principal: São OBRIGATORIOS.",
      "• Telefone principal: O sistema normaliza automaticamente. Ex: 5511999999999 ou apenas 11999999999.",
      "• Whatsapp Username: Se deixado em branco, o sistema tentará extrair do número de telefone automaticamente.",
      "• E-mail e Observações: Opcionais.",
      "• Servidores: Você pode vincular até 5 servidores na mesma linha. Preencha as colunas 'Nome', 'Usuario' e 'Senha'.",
      "• Nome do Servidor: O nome do servidor digitado na planilha deve ser EXATAMENTE IGUAL ao nome cadastrado no seu painel.",
      "🔒 ATENÇÃO 1: Se você preencher o nome de um servidor que NÃO EXISTE, a linha inteira será travada e a revenda não será criada por segurança.",
      "🔒 ATENÇÃO 2: Se você preencher o nome do Servidor, a coluna de 'Usuario' daquele servidor também passa a ser obrigatória.",
      "• Não altere os cabeçalhos das colunas.",
      "• Exclua a linha de exemplo e estas instruções antes de importar. Elas estão aqui apenas para referência."
    ];

    const worksheet = XLSX.utils.aoa_to_sheet([
      headers,
      exampleRow,
      [], 
      ...notes.map((n) => [n]),
    ]);

    worksheet["!cols"] = [
      { wch: 25 }, // Nome
      { wch: 20 }, // Telefone principal
      { wch: 20 }, // Whatsapp Username
      { wch: 25 }, // E-mail
      { wch: 30 }, // Observacoes
      { wch: 22 }, { wch: 18 }, { wch: 15 }, // Srv 1
      { wch: 22 }, { wch: 18 }, { wch: 15 }, // Srv 2
      { wch: 22 }, { wch: 18 }, { wch: 15 }, // Srv 3
      { wch: 22 }, { wch: 18 }, { wch: 15 }, // Srv 4
      { wch: 22 }, { wch: 18 }, { wch: 15 }  // Srv 5
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Disposition": 'attachment; filename="template_importacao_revendas.xlsx"',
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: "Erro ao gerar template." }, { status: 500 });
  }
}