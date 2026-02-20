import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET() {
  const headers = [
    "Saudacao",
    "Nome Completo",
    "Telefone principal",
    "Whatsapp Username",
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
    "Data do cadastro",
    "Cadastro hora",
  ];

  // Linha exemplo (o usuário troca)
  const example = [
    "Sr",
    "João Silva",
    "+5521999999999",
    "5521999999999",
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
    "05/01/2026", // Data do cadastro (opcional)
    "14:30", // Cadastro hora (opcional)
  ];

  const lines: string[] = [];
  lines.push(headers.map(csvEscape).join(";"));
  lines.push(example.map(csvEscape).join(";"));

  // BOM ajuda o Excel a reconhecer UTF-8
  const csv = "\ufeff" + lines.join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="template_import_clientes.csv"`,
      "Cache-Control": "no-store",
    },
  });
}