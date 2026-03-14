import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

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
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const tenantFromQuery = url.searchParams.get("tenant_id");
    const resolved = await resolveTenantIdForUser(supabase, user.id, tenantFromQuery);
    if (!resolved.tenant_id) return NextResponse.json({ error: resolved.error }, { status: resolved.status || 400 });
    const tenant_id = resolved.tenant_id;

    // 1. Busca Revendedores
    const { data: resellers, error: resErr } = await supabase
      .from("resellers")
      .select("id, display_name, email, whatsapp_primary, whatsapp_username, notes")
      .eq("tenant_id", tenant_id)
      .eq("is_archived", false)
      .order("display_name");

    if (resErr) throw resErr;
    if (!resellers || resellers.length === 0) {
      return NextResponse.json({ error: "Nenhum revendedor encontrado." }, { status: 404 });
    }

    // 2. Busca Vínculos de Servidor
    const { data: serversData, error: srvErr } = await supabase
      .from("reseller_servers")
      .select("reseller_id, server_username, server_password, servers(name)")
      .eq("tenant_id", tenant_id);

    if (srvErr) throw srvErr;

    // Agrupa servidores por revendedor
    const serversMap: Record<string, any[]> = {};
    (serversData || []).forEach((link: any) => {
      if (!serversMap[link.reseller_id]) serversMap[link.reseller_id] = [];
      serversMap[link.reseller_id].push({
        name: link.servers?.name || "—",
        username: link.server_username || "",
        password: link.server_password || ""
      });
    });

    // 3. Monta as Linhas (Achatando até 5 servidores)
    const rows = resellers.map((r) => {
      const srvs = serversMap[r.id] || [];
      const rowData: any = {
        "Nome": r.display_name || "",
        "WhatsApp": r.whatsapp_primary || "",
        "Username WhatsApp": r.whatsapp_username || "",
        "E-mail": r.email || "",
        "Observacoes": r.notes || "",
      };

      for (let i = 0; i < 5; i++) {
        const s = srvs[i];
        rowData[`Servidor ${i + 1} Nome`] = s ? s.name : "";
        rowData[`Servidor ${i + 1} Usuario`] = s ? s.username : "";
        rowData[`Servidor ${i + 1} Senha`] = s ? s.password : "";
      }

      return rowData;
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Revendedores");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    
    const now = new Date();
    const filename = `Exportacao_Revendedores_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}