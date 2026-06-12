// app/api/catalogo/novidades/route.ts
// Retorna até 20 títulos recentes com tmdb_confirmado=true para o carrossel
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
    // Busca os 20 mais recentes com TMDB confirmado
    // Se servidor = TODOS, busca nos 3 mas deduplicado por titulo (usa o primeiro encontrado)
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
      .eq("tmdb_confirmado", true)
      .order("adicionado_em", { ascending: false })
      .limit(60); // pega mais para poder deduplicar

    if (servidor !== "TODOS") {
      query = query.eq("servidor", servidor);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Deduplica por titulo_normalizado, mantém o mais recente
    const seen = new Set<string>();
    const deduped: typeof data = [];
    for (const item of (data || [])) {
      if (!seen.has(item.titulo_normalizado)) {
        seen.add(item.titulo_normalizado);
        deduped.push(item);
      }
      if (deduped.length >= 20) break;
    }

    return NextResponse.json({ ok: true, data: deduped });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
