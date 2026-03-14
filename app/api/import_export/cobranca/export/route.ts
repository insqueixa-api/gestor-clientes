import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

const STATUS_MAP: Record<string, string> = { "ACTIVE": "Ativo", "OVERDUE": "Vencido", "TRIAL": "Teste", "ARCHIVED": "Arquivado" };
const DAYS_MAP: Record<number, string> = { 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sab", 0: "Dom" };

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

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;

  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const tenantFromQuery = url.searchParams.get("tenant_id");

  const resolved = await resolveTenantIdForUser(supabase, user.id, tenantFromQuery);
  if (!resolved.tenant_id) return NextResponse.json({ error: resolved.error }, { status: resolved.status || 400 });
  
  const tenant_id = resolved.tenant_id;

  // Puxa regras, templates, servidores e apps
  const [autoRes, serversRes, appsRes, tplRes] = await Promise.all([
    supabase.from("billing_automations").select("*").eq("tenant_id", tenant_id).order("name"),
    supabase.from("servers").select("id, name").eq("tenant_id", tenant_id),
    supabase.rpc("get_my_visible_apps"),
    supabase.from("message_templates").select("id, name").eq("tenant_id", tenant_id)
  ]);

  if (autoRes.error) return NextResponse.json({ error: "export_failed" }, { status: 500 });

  // ✅ Corrigido o TypeScript forçando a tipagem explícita Map<string, string>
  const serversMap = new Map<string, string>((serversRes.data || []).map((s: any) => [String(s.id), String(s.name)]));
  const appsMap = new Map<string, string>((appsRes.data || []).map((a: any) => [String(a.id), String(a.name)]));
  const templatesMap = new Map<string, string>((tplRes.data || []).map((t: any) => [String(t.id), String(t.name)]));

  const headers = [
    "Nome da Cobrança", "Mensagem", "Tipo", "Modo", "Horário (Auto)", "Dias da Semana (Auto)",
    "Status Alvo", "Servidores Alvo", "Planos Alvo", "Apps Alvo",
    "Campo Base", "Dias de Diferença", "Sessão WhatsApp", "Delay Mínimo", "Delay Máximo"
  ];

  const rows = (autoRes.data || []).map((r) => {
    const mapArray = (arr: any[], mapRef?: Map<string, string>) => {
      if (!Array.isArray(arr) || arr.length === 0) return "";
      if (mapRef) return arr.map(id => mapRef.get(id) || id).join(", ");
      return arr.join(", ");
    };

    const statusStr = (r.target_status || []).map((s: string) => STATUS_MAP[s] || s).join(", ");
    const daysStr = (r.schedule_days || []).map((d: number) => DAYS_MAP[d] || d).join(", ");
    const tplName = r.message_template_id ? (templatesMap.get(r.message_template_id) || "") : "";

    return [
      r.name || "",
      tplName, // ✅ Mensagem
      r.type || "Vencimento",
      r.is_automatic ? "Automático" : "Manual",
      r.schedule_time || "",
      daysStr,
      statusStr,
      mapArray(r.target_servers, serversMap),
      mapArray(r.target_plans),
      mapArray(r.target_apps, appsMap),
      r.rule_date_field === "created_at" ? "Cadastro" : "Vencimento",
      String(r.rule_days_diff || 0),
      r.whatsapp_session || "default",
      String(r.delay_min || 15),
      String(r.delay_max || 60)
    ];
  });

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Automações");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  const filename = `automacoes_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}