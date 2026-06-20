// app/api/client-portal/guia-tv/access-stats/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const agora = new Date();
    const inicioHoje = new Date(agora); inicioHoje.setHours(0,0,0,0);
    const inicioSemana = new Date(agora); inicioSemana.setDate(agora.getDate() - 7);
    const inicioMes = new Date(agora); inicioMes.setDate(agora.getDate() - 30);

    const { data: rows, error } = await supabaseAdmin
      .from("guia_tv_access_log")
      .select("servidor, created_at");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const agrupado: Record<string, { total:number; mes:number; semana:number; hoje:number }> = {};

    for (const row of rows || []) {
      const srv = row.servidor || "TODOS";
      if (!agrupado[srv]) agrupado[srv] = { total:0, mes:0, semana:0, hoje:0 };
      agrupado[srv].total++;

      const data = new Date(row.created_at);
      if (data >= inicioMes)    agrupado[srv].mes++;
      if (data >= inicioSemana) agrupado[srv].semana++;
      if (data >= inicioHoje)   agrupado[srv].hoje++;
    }

    const resultado = Object.entries(agrupado)
      .map(([servidor, stats]) => ({ servidor, ...stats }))
      .sort((a, b) => b.total - a.total);

    return NextResponse.json({ ok: true, data: resultado });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}