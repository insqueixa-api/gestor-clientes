import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = [
    "Cliente",
    "Usuario",
    "Servidor",
    "App",
    "Vencimento",
    "Device ID (MAC)",
    "Device Key",
    "E-mail",
    "Senha",
    "URL",
    "Obs",
  ];

  const example = [
    "João Silva",          // Cliente — display_name do cliente
    "joao.silva",          // Usuario — server_username (usado para identificar o cliente)
    "UniTV",               // Servidor — nome do servidor (usado para identificar o cliente)
    "DuplexPlay",          // App — nome exato do app cadastrado
    "20/09/2026",          // Vencimento — DD/MM/AAAA (deixe vazio se o app não tiver)
    "B8:31:B5:A2:51:DE",   // Device ID (MAC) — formato 00:1A:2B:3C:4D:5E (deixe vazio se não tiver)
    "1127848741",          // Device Key (deixe vazio se não tiver)
    "",                    // E-mail (deixe vazio se não tiver)
    "",                    // Senha (deixe vazio se não tiver)
    "",                    // URL (deixe vazio se não tiver)
    "",                    // Obs (deixe vazio se não tiver)
  ];

  const notes = [
    "⚠️ INSTRUÇÕES PARA IMPORTAÇÃO DE APLICATIVOS ⚠️",
    "• Uma linha por aplicativo. O mesmo cliente pode aparecer em múltiplas linhas.",
    "• Cliente é identificado pela combinação de Usuario + Servidor.",
    "• O campo App deve ter o nome exato do aplicativo cadastrado no sistema.",
    "• Preencha apenas as colunas que o aplicativo utiliza. Deixe as demais em branco.",
    "• Vencimento deve estar no formato DD/MM/AAAA.",
    "• Device ID (MAC): aceita qualquer formato (00:1A:2B:3C:4D:5E, 001A2B3C4D5E, 00-1A-2B-3C-4D-5E, etc). O sistema normaliza automaticamente.",
    "• Não altere os cabeçalhos das colunas.",
    "• Exclua as linhas de exemplo e instruções antes de importar. Elas estão aqui apenas para referência.",];

const worksheet = XLSX.utils.aoa_to_sheet([
    headers,
    example,
    [], // linha em branco separadora
    ...notes.map((n) => [n]),
  ], { cellDates: true });

  // Aplica formato DD/MM/YYYY na célula de exemplo da coluna Vencimento (linha 2, col 4)
  const dateCellAddr = XLSX.utils.encode_cell({ r: 1, c: 4 });
  if (worksheet[dateCellAddr]) {
    worksheet[dateCellAddr].z = "DD/MM/YYYY";
  }

  // Largura das colunas para melhor leitura
  worksheet["!cols"] = [
    { wch: 20 }, // Cliente
    { wch: 20 }, // Usuario
    { wch: 20 }, // Servidor
    { wch: 20 }, // App
    { wch: 14 }, // Vencimento
    { wch: 20 }, // Device ID (MAC)
    { wch: 16 }, // Device Key
    { wch: 24 }, // E-mail
    { wch: 14 }, // Senha
    { wch: 30 }, // URL
    { wch: 30 }, // Obs
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Template");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellDates: true });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="template_import_aplicativos.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}