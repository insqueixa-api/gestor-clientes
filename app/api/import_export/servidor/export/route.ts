import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

async function resolveTenantIdForUser(supabase: any, userId: string, tenantFromQuery: string | null) {
  const { data, error } = await supabase.from("tenant_members").select("tenant_id").eq("user_id", userId);
  if (error) return { tenant_id: null as string | null, status: 500, error: "tenant_lookup_failed", details: error.message };

  const tenantIds = Array.from(new Set((data ?? []).map((r: any) => String(r.tenant_id || "")).filter(Boolean))) as string[];
  if (tenantIds.length === 0) return { tenant_id: null, status: 400, error: "tenant_id_missing", hint: "Sem tenant." };
  if (tenantIds.length === 1) {
    if (tenantFromQuery && tenantFromQuery !== tenantIds[0]) return { tenant_id: null, status: 403, error: "forbidden_tenant", hint: "Inválido" };
    return { tenant_id: tenantIds[0], status: 200 };
  }
  if (!tenantFromQuery) return { tenant_id: null, status: 400, error: "tenant_required", hint: "Informe tenant_id." };
  if (!tenantIds.includes(tenantFromQuery)) return { tenant_id: null, status: 403, error: "forbidden_tenant", hint: "Inválido" };
  
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

  const headers = [
    "Nome do Servidor",
    "Tipo de Painel (WEB ou TELEGRAM)",
    "Url ou Grupo Telegram",
    "Moeda (BRL, USD, EUR)",
    "Custo Unitario",
    "Saldo Inicial",
    "DNS 1", "DNS 2", "DNS 3", "DNS 4", "DNS 5", "DNS 6",
    "Observacoes"
  ];

  try {
    // Busca dados (inclui dns e credits)
    const { data: servers, error: srvErr } = await supabase
      .from("servers")
      .select("id, name, panel_type, panel_web_url, panel_telegram_group, default_currency, avg_credit_cost_brl, credits_available, dns, notes")
      .eq("tenant_id", tenant_id)
      .eq("is_archived", false)
      .order("name");

    if (srvErr) throw srvErr;

    if (!servers || servers.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([headers]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Servidores");
      return new NextResponse(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), {
        status: 200, headers: { "Content-Disposition": 'attachment; filename="Exportacao_Servidores.xlsx"', "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      });
    }

    const rows = servers.map((s) => {
      const urlOrGroup = s.panel_type === "WEB" ? s.panel_web_url : s.panel_type === "TELEGRAM" ? s.panel_telegram_group : "";
      const dns = Array.isArray(s.dns) ? s.dns : [];

      return {
        "Nome do Servidor": s.name || "",
        "Tipo de Painel (WEB ou TELEGRAM)": s.panel_type || "",
        "Url ou Grupo Telegram": urlOrGroup || "",
        "Moeda (BRL, USD, EUR)": s.default_currency || "BRL",
        "Custo Unitario": s.avg_credit_cost_brl ? String(s.avg_credit_cost_brl).replace(".", ",") : "",
        "Saldo Inicial": s.credits_available || "0",
        "DNS 1": dns[0] || "",
        "DNS 2": dns[1] || "",
        "DNS 3": dns[2] || "",
        "DNS 4": dns[3] || "",
        "DNS 5": dns[4] || "",
        "DNS 6": dns[5] || "",
        "Observacoes": s.notes || "",
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Servidores");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const filename = `Exportacao_Servidores_${new Date().getTime()}.xlsx`;

    return new NextResponse(buffer, {
      status: 200, headers: { "Content-Disposition": `attachment; filename="${filename}"`, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}