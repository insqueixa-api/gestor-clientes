import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

function normalizeHeader(h: string) {
  return (h || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const tenant_id = url.searchParams.get("tenant_id");
  if (!tenant_id) return NextResponse.json({ error: "tenant_required" }, { status: 400 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file_missing" }, { status: 400 });

  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
  
  const dataRows = allRows.filter((r: any[]) => {
    const first = String(r[0] ?? "").trim();
    if (!first) return false; 
    if (first.startsWith("⚠️") || first.startsWith("•") || first.startsWith("📌") || first.includes("{")) return false; 
    return true;
  });

  if (dataRows.length < 2) return NextResponse.json({ error: "empty_file", hint: "Sem dados para processar." }, { status: 400 });

  const headers = (dataRows[0] as any[]).map(String);
  const rows = dataRows.slice(1) as any[][];

  const colIndex = new Map<string, number>();
  headers.forEach((h, idx) => colIndex.set(normalizeHeader(h), idx));

  if (!colIndex.has("nome do modelo") || !colIndex.has("conteudo da mensagem")) {
    return NextResponse.json({ error: "invalid_headers", hint: "As colunas Nome do Modelo e Conteúdo da Mensagem são obrigatórias." }, { status: 400 });
  }

  const getCell = (row: any[], key: string): string => {
    const idx = colIndex.get(normalizeHeader(key));
    if (idx === undefined) return "";
    return (row[idx] ?? "").toString().trim();
  };

  // Carrega os templates atuais para saber se faz UPDATE ou INSERT
  const { data: currentTemplates } = await supabase.from("message_templates").select("id, name").eq("tenant_id", tenant_id);
  const currentMap = new Map<string, string>();
  (currentTemplates || []).forEach(t => currentMap.set(t.name.toLowerCase().trim(), t.id));

  let inserted = 0;
  const rowErrors: Array<{ row: number; error: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    try {
      const name = getCell(row, "Nome do Modelo");
      const content = getCell(row, "Conteúdo da Mensagem");

      if (!name) throw new Error("Nome do Modelo vazio.");
      if (!content) throw new Error("Conteúdo da Mensagem vazio.");

      const existingId = currentMap.get(name.toLowerCase());

      if (existingId) {
        // UPDATE se o nome já existe
        const { error } = await supabase.from("message_templates").update({ content, updated_at: new Date().toISOString() }).eq("id", existingId);
        if (error) throw error;
      } else {
        // INSERT novo
        const { error } = await supabase.from("message_templates").insert({
          tenant_id,
          name,
          content,
          updated_at: new Date().toISOString()
        });
        if (error) throw error;
      }

      inserted++;
    } catch (e: any) {
      rowErrors.push({ row: rowNum, error: e?.message || "Falha ao salvar linha." });
    }
  }

  return NextResponse.json({ ok: rowErrors.length === 0, total: rows.length, inserted, errors: rowErrors });
}