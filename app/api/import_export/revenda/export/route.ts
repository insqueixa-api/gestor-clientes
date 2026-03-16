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
    "Nome", 
    "Telefone principal", // ✅ Alterado
    "Whatsapp Username",  // ✅ Alterado
    "E-mail", 
    "Observacoes",
    "Servidor 1 Nome", "Servidor 1 Usuario", "Servidor 1 Senha",
    "Servidor 2 Nome", "Servidor 2 Usuario", "Servidor 2 Senha",
    "Servidor 3 Nome", "Servidor 3 Usuario", "Servidor 3 Senha",
    "Servidor 4 Nome", "Servidor 4 Usuario", "Servidor 4 Senha",
    "Servidor 5 Nome", "Servidor 5 Usuario", "Servidor 5 Senha"
  ];

  try {
    // 1. LÓGICA À PROVA DE BALAS: Tenta buscar da View primeiro
    let { data: resellers, error: resErr } = await supabase
      .from("vw_resellers_list_active") // Tenta a view que agrupa tudo
      .select("*")
      .eq("tenant_id", tenant_id);

    let phonesData: any[] = [];

    // Se a view falhar (nome diferente), busca direto na tabela raiz + tabela de telefones
    if (resErr || !resellers) {
      const fallback = await supabase.from("resellers").select("*").eq("tenant_id", tenant_id).eq("is_archived", false);
      resellers = fallback.data || [];
      
      // Busca a tabela de telefones para fazer o join manual
      const ph = await supabase.from("reseller_phones").select("*").eq("tenant_id", tenant_id);
      phonesData = ph.data || [];
    }

    if (!resellers || resellers.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([headers]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Revendedores");
      return new NextResponse(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), {
        status: 200, headers: { "Content-Disposition": 'attachment; filename="Exportacao_Revendedores.xlsx"', "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      });
    }

    // 2. Busca Vínculos de Servidor
    const { data: serversData } = await supabase.from("reseller_servers").select("reseller_id, server_username, server_password, servers(name)").eq("tenant_id", tenant_id);
    const serversMap: Record<string, any[]> = {};
    (serversData || []).forEach((link: any) => {
      if (!serversMap[link.reseller_id]) serversMap[link.reseller_id] = [];
      serversMap[link.reseller_id].push({
        name: link.servers?.name || "—",
        username: link.server_username || "",
        password: link.server_password || ""
      });
    });

    // 3. Monta as Linhas
    const rows = resellers.map((r: any) => {
      const srvs = serversMap[r.id] || [];
      
      // Extração inteligente do telefone (seja da view ou da tabela auxiliar)
      let phoneVal = r.whatsapp_e164 || r.whatsapp_primary || r.primary_whatsapp_e164 || r.phone || "";
      if (!phoneVal && phonesData.length > 0) {
         const pObj = phonesData.find((p: any) => p.reseller_id === r.id);
         phoneVal = pObj ? (pObj.e164 || pObj.phone_e164 || pObj.phone || "") : "";
      }

      const rowData: any = {
        "Nome": r.display_name || r.name || "",
        "Telefone principal": phoneVal, // ✅ Agora vai preenchido!
        "Whatsapp Username": r.whatsapp_username || "",
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

const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    
    // ✅ Forçar colunas de telefone a serem lidas como Texto no Excel
    // Índices (0-based): 1 (Telefone principal), 2 (Whatsapp Username)
    const textColumns = [1, 2]; 
    
    // Pula o cabeçalho (linha 0), vai até o total de linhas geradas
    for (let R = 1; R <= rows.length; R++) { 
      textColumns.forEach(C => {
        const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
        if (worksheet[cellAddress]) {
          worksheet[cellAddress].t = 's'; // Garante que o tipo de dado é string
          worksheet[cellAddress].z = '@'; // Define o formato da célula no Excel como "Texto"
        }
      });
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Revendedores");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const now = new Date();
    const filename = `Exportacao_Revendedores_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.xlsx`;

    return new NextResponse(buffer, {
      status: 200, headers: { "Content-Disposition": `attachment; filename="${filename}"`, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}