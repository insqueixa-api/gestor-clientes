import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

function normalizeStr(s: any) {
  return (s || "").toString().trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

async function resolveTenantIdForUser(supabase: any, userId: string, tenantFromQuery: string | null) {
  const { data, error } = await supabase.from("tenant_members").select("tenant_id").eq("user_id", userId);
  if (error) return { tenant_id: null as string | null, status: 500, error: "tenant_lookup_failed", details: error.message };
  const tenantIds = Array.from(new Set((data ?? []).map((r: any) => String(r.tenant_id || "")).filter(Boolean))) as string[];
  if (tenantIds.length === 0) return { tenant_id: null, status: 400, error: "tenant_id_missing", hint: "Sem vínculo." };
  if (tenantIds.length === 1) {
    if (tenantFromQuery && tenantFromQuery !== tenantIds[0]) return { tenant_id: null, status: 403, error: "forbidden" };
    return { tenant_id: tenantIds[0], status: 200 };
  }
  if (!tenantFromQuery) return { tenant_id: null, status: 400, error: "tenant_required", hint: "Múltiplos tenants." };
  if (!tenantIds.includes(tenantFromQuery)) return { tenant_id: null, status: 403, error: "forbidden" };
  return { tenant_id: tenantFromQuery, status: 200 };
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;

  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const tenantFromQuery = url.searchParams.get("tenant_id");

  const resolved = await resolveTenantIdForUser(supabase, user.id, tenantFromQuery);
  if (!resolved.tenant_id) return NextResponse.json({ error: resolved.error }, { status: resolved.status || 400 });
  const tenant_id = resolved.tenant_id;

  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_missing" }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
  
  const dataRows = allRows.filter(r => {
    const first = String(r[0] ?? "").trim();
    return first && !first.startsWith("⚠️") && !first.startsWith("•") && !first.startsWith("🔒");
  });

  if (dataRows.length < 2) return NextResponse.json({ error: "empty_file" }, { status: 400 });

  const headers = (dataRows[0] as any[]).map(String);
  const rows = dataRows.slice(1) as any[][];

  const colIndex = new Map<string, number>();
  headers.forEach((h, idx) => colIndex.set(normalizeStr(h), idx));

  const getCell = (row: any[], key: string): string => {
    const idx = colIndex.get(normalizeStr(key));
    if (idx === undefined) return "";
    let val = row[idx];
    if (val instanceof Date) {
        const hh = String(val.getUTCHours()).padStart(2, "0");
        const mm = String(val.getUTCMinutes()).padStart(2, "0");
        return `${hh}:${mm}`;
    }
    return (val ?? "").toString().trim();
  };

  // ✅ Busca servidores, apps E templates de mensagens
  const [serversRes, appsRes, tplRes] = await Promise.all([
    supabase.from("servers").select("id, name").eq("tenant_id", tenant_id),
    supabase.rpc("get_my_visible_apps"),
    supabase.from("message_templates").select("id, name").eq("tenant_id", tenant_id)
  ]);

  // ✅ Mapas com Tipagem Correta
  const nameToServerId = new Map<string, string>((serversRes.data || []).map((s: any) => [normalizeStr(s.name), String(s.id)]));
  const nameToAppId = new Map<string, string>((appsRes.data || []).map((a: any) => [normalizeStr(a.name), String(a.id)]));
  const nameToTemplateId = new Map<string, string>((tplRes.data || []).map((t: any) => [normalizeStr(t.name), String(t.id)]));

  const parseArray = (val: string, mapRef?: Map<string, string>) => {
    if (!val) return [];
    return val.split(",").map(v => {
        const clean = v.trim();
        if (mapRef) return mapRef.get(normalizeStr(clean)) || null; 
        return clean;
    }).filter(Boolean); 
  };

  const parseStatus = (val: string) => {
    if (!val) return [];
    const mapStatus: Record<string, string> = { "ativo": "ACTIVE", "vencido": "OVERDUE", "teste": "TRIAL", "arquivado": "ARCHIVED" };
    return val.split(",").map(v => mapStatus[normalizeStr(v)]).filter(Boolean);
  };

  const parseDays = (val: string) => {
    if (!val) return [];
    const mapDays: Record<string, number> = { "seg": 1, "ter": 2, "qua": 3, "qui": 4, "sex": 5, "sab": 6, "dom": 0 };
    return val.split(",").map(v => mapDays[normalizeStr(v.substring(0,3))]).filter(v => v !== undefined);
  };

  let inserted = 0;
  const rowErrors: Array<{ row: number; error: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    try {
      const name = getCell(row, "Nome da Cobrança");
      if (!name) throw new Error("Nome é obrigatório");

      const mode = normalizeStr(getCell(row, "Modo"));
      
      // ✅ Resolve ID do Template (se fornecido)
      const templateName = getCell(row, "Mensagem");
      const templateId = templateName ? nameToTemplateId.get(normalizeStr(templateName)) : null;

      const payload = {
        tenant_id: tenant_id,
        name: name,
        type: getCell(row, "Tipo") || "Vencimento",
        is_automatic: mode === "automatico",
        
        // 🔒 PROTEÇÃO: Toda regra importada via Excel entra DESLIGADA
        is_active: false, 
        message_template_id: templateId || null,
        
        schedule_time: getCell(row, "Horário (Auto)") || "10:00",
        schedule_days: parseDays(getCell(row, "Dias da Semana (Auto)")),
        
        target_status: parseStatus(getCell(row, "Status Alvo")),
        target_servers: parseArray(getCell(row, "Servidores Alvo"), nameToServerId),
        target_plans: parseArray(getCell(row, "Planos Alvo")), 
        target_apps: parseArray(getCell(row, "Apps Alvo"), nameToAppId),
        
        rule_date_field: normalizeStr(getCell(row, "Campo Base")) === "cadastro" ? "created_at" : "vencimento",
        rule_days_diff: Number(getCell(row, "Dias de Diferença")) || 0,
        
        whatsapp_session: getCell(row, "Sessão WhatsApp") || "default",
        delay_min: Number(getCell(row, "Delay Mínimo")) || 15,
        delay_max: Number(getCell(row, "Delay Máximo")) || 60,
      };

      const { error } = await supabase.from("billing_automations").insert(payload);
      if (error) throw new Error(error.message);

      inserted++;
    } catch (e: any) {
      rowErrors.push({ row: rowNum, error: e?.message || "Erro desconhecido." });
    }
  }

  return NextResponse.json({
    ok: rowErrors.length === 0,
    total: rows.length,
    inserted,
    errors: rowErrors,
  });
}