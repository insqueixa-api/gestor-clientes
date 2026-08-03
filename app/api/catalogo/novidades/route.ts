// app/api/catalogo/novidades/route.ts
// PARA:
// Usa vw_catalog_novidades diretamente (já tem todos os campos)
// Exige tmdb_confirmado = true e poster_tmdb_url real — mesmo critério do
// titulos/route.ts, aplicado ANTES do corte de 60 únicos (senão o corte pode
// "gastar" vagas com títulos que seriam descartados depois, e Lançamentos de
// verdade ficarem de fora).
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
        id, titulo_normalizado, titulo_exibicao, tipo,
        cover_url, poster_tmdb_url,
        ano, sinopse, avaliacao, generos,
        total_temporadas, total_episodios,
        tmdb_confirmado,
        servidor, categoria_origem, adicionado_em
      `)
      .eq("tipo", tipo)
      .eq("tmdb_confirmado", true)
      .not("poster_tmdb_url", "is", null)
      .order("adicionado_em", { ascending: false })
      .limit(300); // pega bastante para deduplicar e atingir 60 únicos

    if (servidor !== "TODOS") {
      query = query.eq("servidor", servidor);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Deduplica por titulo_normalizado, prefere quem tem poster_tmdb_url
    const seen = new Map<string, any>();
    for (const item of (data || [])) {
      const key = item.titulo_normalizado;
      const existing = seen.get(key);
      if (!existing || (!existing.poster_tmdb_url && item.poster_tmdb_url)) {
        seen.set(key, item);
      }
            if (seen.size >= 100) break; // retorna até 100 únicos (2 páginas de 50)

    }

    return NextResponse.json({ ok: true, data: [...seen.values()] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
