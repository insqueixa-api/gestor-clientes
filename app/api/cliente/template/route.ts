import { NextResponse } from "next/server";
import * as XLSX from "xlsx"; // ✅ NOVO

export const dynamic = "force-dynamic";

export async function GET() {
  
  const headers = [
    "Saudacao",
    "Nome Completo",
    "Telefone principal",
    "Whatsapp Username",
    "Secundario Saudacao", // ✅ NOVO
    "Secundario Nome", // ✅ NOVO
    "Secundario Telefone", // ✅ NOVO
    "Secundario Whatsapp", // ✅ NOVO
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
    "Aplicativos nome",
    "Obs",

// ✅ NOVOS (sempre no final)
    "Valor Plano",
    "Tabela Preco",
    "M3U URL",
    "ID Externo", // ✅ NOVO
    "Data do cadastro",
    "Cadastro hora",
  ];

  // Linha exemplo (o usuário troca)
  const example = [
    "Sr",
    "João Silva",
    "+5521999999999",
    "5521999999999",
    "Sra", // ✅ Exemplo: Secundario Saudacao
    "Maria Silva", // ✅ Exemplo: Secundario Nome
    "+5521888888888", // ✅ Exemplo: Secundario Telefone
    "5521888888888", // ✅ Exemplo: Secundario Whatsapp
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
    "IBO Player, XCIPTV",
    "Cliente importado via planilha",

// ✅ NOVOS (exemplos — pode deixar em branco)
    "40,00", // Valor Plano (pode ficar vazio)
    "Padrao BRL", // Tabela Preco (label exato da plan_tables.name — pode ficar vazio)
    "http://exemplo.com/lista.m3u", // M3U URL (opcional)
    "199200", // ID Externo (ID do cliente no painel - opcional) // ✅ NOVO
    "05/01/2026", // Data do cadastro (opcional)
    "14:30", // Cadastro hora (opcional)
  ];

  // ✅ Geração do Excel nativo em vez de linhas de texto CSV
  const worksheet = XLSX.utils.aoa_to_sheet([headers, example]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Template");

  // Cria o ficheiro em memória (buffer)
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      // ✅ MIME Type do Excel e nova extensão (.xlsx)
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="template_import_clientes.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}