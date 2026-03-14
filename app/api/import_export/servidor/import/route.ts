import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

function normalizeHeader(h: string) {
  return (h || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}

function slugify(text: string) {
  return text.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_").replace(/[^\w-]+/g, "").replace(/__+/g, "_").replace(/^_+|_+$/g, "");
}

async function resolveTenantIdForUser(supabase: any, userId: string, tenantFromQuery: string | null) {
  const { data, error } = await supabase.from("tenant_members").select("tenant_id").eq("user_id", userId);
  if (error) return { tenant_id: null as string | null, status: 500, error: "tenant_lookup_failed", details: error.message };

  const tenantIds = Array.from(new Set((data ?? []).map((r: any) => String(r.tenant_id || "")).filter(Boolean))) as string[];
  if (tenantIds.length === 0) return { tenant_id: null, status: 400, error: "tenant_id_missing", hint: "Sem tenant." };
  if (tenantIds.length === 1) return { tenant_id: tenantIds[0], status: 200 };
  if (!tenantFromQuery) return { tenant_id: null, status: 400, error: "tenant_required", hint: "Informe tenant_id." };
  if (!tenantIds.includes(tenantFromQuery)) return { tenant_id: null, status: 403, error: "forbidden_tenant", hint: "Inválido" };
  
  return { tenant_id: tenantFromQuery, status: 200 };
}

const REQUIRED_HEADERS = ["nome do servidor"];

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const tenant_id = url.searchParams.get("tenant_id");
  const resolved = await resolveTenantIdForUser(supabase, auth.user.id, tenant_id);
  if (!resolved.tenant_id) return NextResponse.json({ error: resolved.error }, { status: resolved.status || 400 });
  const finalTenantId = resolved.tenant_id;

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
    if (first.startsWith("⚠️") || first.startsWith("•") || first.startsWith("🔒")) return false; 
    return true;
  });

  if (dataRows.length < 2) return NextResponse.json({ error: "empty_file", hint: "Sem dados." }, { status: 400 });

  const headers = (dataRows[0] as any[]).map(String);
  const rows = dataRows.slice(1) as any[][];
  const colIndex = new Map<string, number>();
  headers.forEach((h, idx) => colIndex.set(normalizeHeader(h), idx));

  const missing = REQUIRED_HEADERS.filter((h) => !colIndex.has(h));
  if (missing.length) return NextResponse.json({ error: "invalid_headers", missing }, { status: 400 });

  const getCell = (row: any[], key: string): string => {
    const idx = colIndex.get(normalizeHeader(key));
    return idx !== undefined ? (row[idx] ?? "").toString().trim() : "";
  };

  let inserted = 0;
  const rowErrors: Array<{ row: number; error: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    try {
      const name = getCell(row, "Nome do Servidor");
      if (!name) throw new Error("Nome do Servidor vazio.");

      const panelTypeRaw = getCell(row, "Tipo de Painel (WEB ou TELEGRAM)").toUpperCase();
      const panelType = ["WEB", "TELEGRAM"].includes(panelTypeRaw) ? panelTypeRaw : null;
      
      const panelUrl = getCell(row, "Url ou Grupo Telegram");
      let webUrl = null;
      let telegramGroup = null;
      
      if (panelType === "WEB") {
        webUrl = panelUrl;
        if (webUrl && !webUrl.startsWith("http")) webUrl = "https://" + webUrl;
      } else if (panelType === "TELEGRAM") {
        telegramGroup = panelUrl;
      }

      const rawCurrency = getCell(row, "Moeda (BRL, USD, EUR)").toUpperCase();
      const currency = ["BRL", "USD", "EUR"].includes(rawCurrency) ? rawCurrency : "BRL";

      const costRaw = getCell(row, "Custo Unitario").replace(",", ".");
      const cost = parseFloat(costRaw);
      const safeCost = !isNaN(cost) && cost >= 0 ? cost : null;

      const creditsRaw = getCell(row, "Saldo Inicial").replace(",", ".");
      const credits = parseFloat(creditsRaw);
      const safeCredits = !isNaN(credits) && credits >= 0 ? credits : 0;

      // Monta DNS
      const dnsList = [];
      for (let d = 1; d <= 6; d++) {
        const dns = getCell(row, `DNS ${d}`);
        if (dns) dnsList.push(dns);
      }

      const notes = getCell(row, "Observacoes");

      // Trata o Slug (evita colisão simples)
      const baseSlug = slugify(name) || `server_${Date.now()}`;
      
      // ✅ Como é planilha e pode vir vários ao mesmo tempo, geramos um sufixo pequeno aleatório
      // O correto seria um loop checando no DB como você fez na UI, mas em bulk insert de planilha isso onera muito o DB.
      const finalSlug = `${baseSlug}_${Math.floor(Math.random() * 1000)}`;

      // Insert do Servidor
      const { error } = await supabase.from("servers").insert({
        tenant_id: finalTenantId,
        name,
        slug: finalSlug,
        panel_type: panelType,
        panel_web_url: webUrl,
        panel_telegram_group: telegramGroup,
        default_currency: currency,
        avg_credit_cost_brl: safeCost,
        credits_available: safeCredits,
        dns: dnsList,
        notes: notes || null,
        is_archived: false
      });

      if (error) throw error;
      inserted++;
    } catch (e: any) {
      rowErrors.push({ row: rowNum, error: e?.message || "Falha ao salvar linha." });
    }
  }

  return NextResponse.json({ ok: rowErrors.length === 0, total: rows.length, inserted, errors: rowErrors });
}