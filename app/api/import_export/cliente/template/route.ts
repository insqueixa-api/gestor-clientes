import { NextResponse } from "next/server";
import * as XLSX from "xlsx"; // ✅ NOVO

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = [
    "Saudacao",
    "Nome Completo",
    "Telefone principal",
    "Whatsapp Username",
    "Secundario Saudacao",
    "Secundario Nome",
    "Secundario Telefone",
    "Secundario Whatsapp",
    "Aceita mensagem",
    "Servidor",
    "Usuario",
    "Senha",
    "Tecnologia",
    "Currency",
    "Plano",
    "Telas",
    "Vencimento dia",
    "Vencimento hora",
    "Obs",
    "Valor Plano",
    "Tabela Preco",
    "M3U URL",
    "ID Externo",
    "Data do cadastro",
    "Cadastro hora",
  ];

  // Linha exemplo (o usuário troca)
  const example = [
    "Sr",
    "João Silva",
    "+5521999999999",
    "5521999999999",
    "Sra",
    "Maria Silva",
    "+5521888888888",
    "5521888888888",
    "Sim",
    "UniTV",
    "joao.silva",
    "123456",
    "IPTV",
    "BRL",
    "Mensal",
    "1",
    "10/02/2026",
    "21:00",
    "Cliente importado via planilha",
    "40,00",
    "Padrao BRL",
    "http://exemplo.com/lista.m3u",
    "199200",
    "05/01/2026",
    "14:30",
  ];

  // ✅ Instruções que aparecerão na planilha abaixo da linha de exemplo
  const notes = [
    "⚠️ INSTRUÇÕES PARA IMPORTAÇÃO DE CLIENTES ⚠️",
    "• Campos Obrigatórios: Nome Completo, Telefone principal, Servidor e Usuario.",
    "• Servidor: O nome do servidor deve ser EXATAMENTE IGUAL ao nome cadastrado no seu painel UniGestor.",
    "• Tecnologia: Ex: IPTV, P2P, OTT ou o nome personalizado usado no sistema.",
    "• Plano: Preencha com Mensal, Bimestral, Trimestral, Semestral ou Anual.",
    "• Tabela Preco: Se for usar, deve ser o nome EXATO da tabela (Ex: Padrao BRL). Se deixar vazio, o sistema usa a padrão.",
    "• Datas (Vencimento / Cadastro): Devem estar obrigatoriamente no formato DD/MM/AAAA (Ex: 10/02/2026).",
    "• Horários (Vencimento / Cadastro): Devem estar no formato HH:MM (Ex: 21:00 ou 14:30).",
    "• Valor Plano: Preencha apenas os números e vírgula para os centavos (Ex: 40,00).",
    "• Aceita mensagem: Preencha com 'Sim' ou 'Não' (Se deixar em branco, o padrão será 'Sim').",
    "• Telefones e WhatsApp: O sistema formata e identifica o DDI automaticamente.",
    "• Não altere, não apague e não mude a ordem dos cabeçalhos das colunas (Linha 1).",
    "• Exclua a linha de exemplo e estas instruções antes de realizar o upload do arquivo."
  ];

  // Geração do Excel nativo com cabeçalho, exemplo, linha em branco e as notas
  const worksheet = XLSX.utils.aoa_to_sheet([
    headers,
    example,
    [], // linha em branco separadora
    ...notes.map((n) => [n]),
  ], { cellDates: true });

  // Aplica formato DD/MM/YYYY na célula de exemplo da coluna Vencimento dia (linha 2, col 17)
  const dueCellAddr = XLSX.utils.encode_cell({ r: 1, c: 16 });
  if (worksheet[dueCellAddr]) worksheet[dueCellAddr].z = "DD/MM/YYYY";

  // Aplica formato DD/MM/YYYY na célula de exemplo da coluna Data de cadastro (linha 2, col 24)
  const createdCellAddr = XLSX.utils.encode_cell({ r: 1, c: 23 });
  if (worksheet[createdCellAddr]) worksheet[createdCellAddr].z = "DD/MM/YYYY";

  // ✅ Largura das colunas para melhor leitura
  worksheet["!cols"] = [
    { wch: 10 }, // Saudacao
    { wch: 25 }, // Nome Completo
    { wch: 18 }, // Telefone principal
    { wch: 20 }, // Whatsapp Username
    { wch: 20 }, // Secundario Saudacao
    { wch: 25 }, // Secundario Nome
    { wch: 20 }, // Secundario Telefone
    { wch: 20 }, // Secundario Whatsapp
    { wch: 15 }, // Aceita mensagem
    { wch: 20 }, // Servidor
    { wch: 20 }, // Usuario
    { wch: 15 }, // Senha
    { wch: 12 }, // Tecnologia
    { wch: 10 }, // Currency
    { wch: 15 }, // Plano
    { wch: 8 },  // Telas
    { wch: 15 }, // Vencimento dia
    { wch: 18 }, // Vencimento hora
    { wch: 35 }, // Obs
    { wch: 15 }, // Valor Plano
    { wch: 20 }, // Tabela Preco
    { wch: 35 }, // M3U URL
    { wch: 15 }, // ID Externo
    { wch: 18 }, // Data do cadastro
    { wch: 18 }, // Cadastro hora
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Template");

  // Cria o arquivo em memória (buffer)
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", cellDates: true });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="template_import_clientes.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}