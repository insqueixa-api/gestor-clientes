import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const tenantFromQuery = url.searchParams.get("tenant_id");
    if (!tenantFromQuery) return NextResponse.json({ error: "tenant_required" }, { status: 400 });

    const { data: templates, error } = await supabase
      .from("message_templates")
      .select("name, content")
      .eq("tenant_id", tenantFromQuery)
      .order("name");

    if (error) throw error;

    const headers = ["Nome do Modelo", "Conteúdo da Mensagem"];

    if (!templates || templates.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([headers]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Mensagens");
      return new NextResponse(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), {
        status: 200, headers: { "Content-Disposition": 'attachment; filename="Exportacao_Mensagens.xlsx"', "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      });
    }

    const rows = templates.map(t => [t.name || "", t.content || ""]);
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    
    worksheet["!cols"] = [{ wch: 35 }, { wch: 80 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Mensagens");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="Exportacao_Mensagens.xlsx"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}