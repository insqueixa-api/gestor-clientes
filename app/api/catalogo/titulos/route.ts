// app/api/catalogo/titulos/route.ts
// Retorna 25 títulos de uma categoria específica (paginado)
// GET ?servidor=ELITE&tipo=FILME&categoria=DRAMA&page=1

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const PER_PAGE = 25;

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const servidor  = searchParams.get("servidor")  || "ELITE";
  const tipo      = searchParams.get("tipo")      || "FILME";
  const categoria = searchParams.get("categoria") || "";
  const page      = Math.max(1, parseInt(searchParams.get("page") || "1"));

  if (!categoria) {
    return NextResponse.json({ ok: false, error: "categoria obrigatória" }, { status: 400 });
  }

  const offset = (page - 1) * PER_PAGE;

  try {
    const { data, error, count } = await supabaseAdmin
      .from("catalog_availability")
      .select(`
        master_id,
        categoria_origem,
        adicionado_em,
        catalog_master!inner (
          id,
          titulo_normalizado,
          tipo,
          cover_url,
          poster_tmdb_url,
          ano,
          sinopse,
          avaliacao,
          generos,
          total_temporadas,
          total_episodios,
          tmdb_id,
          tmdb_confirmado
        )
      `, { count: "exact" })
      .eq("servidor", servidor)
      .eq("categoria_origem", categoria)
      .eq("catalog_master.tipo", tipo)
      .order("adicionado_em", { ascending: false })
      .range(offset, offset + PER_PAGE - 1);

    if (error) throw error;

    const titulos = (data || []).map((row: any) => ({
      ...row.catalog_master,
      categoria_origem: row.categoria_origem,
      adicionado_em:    row.adicionado_em,
    }));

    return NextResponse.json({
      ok:       true,
      data:     titulos,
      total:    count || 0,
      page,
      per_page: PER_PAGE,
      has_more: (count || 0) > offset + PER_PAGE,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
