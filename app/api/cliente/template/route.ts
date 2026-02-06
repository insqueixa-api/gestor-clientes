import { NextResponse } from "next/server";

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
];


  const lines: string[] = [];
  lines.push(headers.map(csvEscape).join(";"));
  lines.push(example.map(csvEscape).join(";"));

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
