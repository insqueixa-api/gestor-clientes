// app/api/catalogo/novidades/route.ts
// Usa vw_catalog_novidades diretamente (já tem todos os campos)
// Sem filtro de tmdb_confirmado — poster_tmdb_url é fallback de cover_url no front
// GET ?servidor=ELITE|NATV|FAST|TODOS&tipo=FILME|SERIE

import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseAdmin = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const servidor = searchParams.get("servidor") || "TODOS";
  const tipo     = searchParams.get("tipo")     || "FILME";

  try {
    let query = supabaseAdmin
      .from("vw_catalog_novidades")
      .select(`
        id, titulo_normalizado, tipo,
        cover_url, poster_tmdb_url,
        ano, sinopse, avaliacao, generos,
        total_temporadas, total_episodios,
        servidor, categoria_origem, adicionado_em
      `)
      .eq("tipo", tipo)
      .order("adicionado_em", { ascending: false })
      .limit(80); // pega mais para deduplicar

    if (servidor !== "TODOS") {
      query = query.eq("servidor", servidor);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Deduplica por titulo_normalizado
    // Prefere o que tem poster_tmdb_url não nulo
    const seen = new Map<string, any>();
    for (const item of (data || [])) {
      const key = item.titulo_normalizado;
      const existing = seen.get(key);
      if (!existing || (!existing.poster_tmdb_url && item.poster_tmdb_url)) {
        seen.set(key, item);
      }
      if (seen.size >= 20) break;
    }

    return NextResponse.json({ ok: true, data: [...seen.values()] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
